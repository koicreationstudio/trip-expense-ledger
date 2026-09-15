import { and, desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import { exchangeRecords, expenses, participants, paymentMethods, trips, wallets } from '@/lib/db/schema';
import { getCurrentIdentity } from '@/lib/auth/current-session';
import { loadMyShareBreakdown, loadSettlementInput } from '@/lib/db/settlement-query';
import { computeNetBalances } from '@/lib/domain/settlement';
import { formatMoney } from '@/lib/money';
import { ExpenseList } from './expense-list';
import { WalletCard } from './wallet-card';
import { ExchangeRecordList } from './exchange-record-list';
import { FxRateCard } from './fx-rate-card';
import { FxChannelCompareCard } from './fx-channel-compare-card';
import { loadEnabledPaymentMethodIds, paymentMethodOwnerFilter } from '@/lib/domain/payment-method-scope';

const STATUS_LABEL: Record<string, string> = {
  active: '记账中',
  settled: '已结算',
  archived: '已归档',
};

export default async function TripPage({ params }: { params: { tripId: string } }) {
  const identity = await getCurrentIdentity();
  if (!identity || identity.tripId !== params.tripId) {
    redirect('/');
  }

  const db = await getDb();
  const trip = await db.query.trips.findFirst({ where: eq(trips.id, params.tripId) });
  if (!trip) {
    redirect('/');
  }

  const tripParticipants = await db.select().from(participants).where(eq(participants.tripId, params.tripId));
  const nameById = new Map(tripParticipants.map((p) => [p.id, p.displayName]));

  // ① 余额 hero + ② 参与者净额清单共用同一份结算计算，一次查询两处复用。
  const settlementInput = await loadSettlementInput(db, params.tripId);
  const netBalances = computeNetBalances(settlementInput);
  const myNet = netBalances.get(identity.participantId) ?? 0;
  const unsettledCount = settlementInput.length;

  // 「我承担」明细（2026-09-16 新增，见 lib/db/settlement-query.ts 顶部注释）：
  // 跟上面 myNet 是两个不同的数字——myNet 是"付出减分摊"的净额（该收/该付），
  // 这里是"我自己该承担多少"的毛份额，机票/宝石这类被标了 excludeFromSplit
  // 的消费会从主数字里摘出来单独成行，不写死只认这两个分类。
  const myShareGroups = await loadMyShareBreakdown(db, params.tripId, identity.participantId);
  const myShareIncluded = myShareGroups.find((g) => !g.excludeFromSplit);
  const myShareExcluded = [...myShareGroups.filter((g) => g.excludeFromSplit)].sort(
    (a, b) => b.grossBaseCurrency - a.grossBaseCurrency
  );
  const myShareNet = myShareIncluded?.netBaseCurrency ?? 0;
  const myShareGross = myShareIncluded?.grossBaseCurrency ?? 0;
  const myShareCount = myShareIncluded?.count ?? 0;
  const hasAnyMyShare = myShareGroups.length > 0;
  // 分类文案去掉 emoji 前缀（"✈️ 机票" → "机票"），行首摘要句用得上；分类明细
  // 行本身还是显示带 emoji 的完整分类名，跟活动流/结算页的展示习惯保持一致。
  const stripCategoryEmoji = (label: string) => {
    const spaceIdx = label.indexOf(' ');
    return spaceIdx > -1 ? label.slice(spaceIdx + 1) : label;
  };
  const myShareIncludedLabel =
    myShareExcluded.length > 0
      ? `不含${myShareExcluded.map((g) => stripCategoryEmoji(g.category)).join('、')}`
      : '我承担的消费';

  // ③ 活动流：整个行程的消费都要看见（同行人分摊的前提是能看到对方记了什么），
  // 不再按 enteredByParticipantId 过滤。编辑/删除权限边界仍然只认自己录入的那些，
  // 交给 ExpenseList 按 `mine` 字段区分，不是靠这里少查数据来兜底。
  const tripExpenses = await db
    .select()
    .from(expenses)
    .where(eq(expenses.tripId, params.tripId))
    .orderBy(desc(expenses.expenseDate));

  // 钱包 + 换汇记录都私有：硬编码 participant_id = 自己，跟活动流那种「整个行程可见」
  // 是完全不同的性质（这里是「我自己的现金在哪张卡/现金里」，不共享）。
  const myWallets = await db
    .select()
    .from(wallets)
    .where(and(eq(wallets.tripId, params.tripId), eq(wallets.participantId, identity.participantId)))
    .orderBy(wallets.createdAt);

  const myExchangeRecords = await db
    .select()
    .from(exchangeRecords)
    .where(and(eq(exchangeRecords.tripId, params.tripId), eq(exchangeRecords.participantId, identity.participantId)))
    .orderBy(desc(exchangeRecords.exchangeDate));

  const walletById = new Map(myWallets.map((w) => [w.id, w]));

  // 钱包卡片上要能显示「绑了哪个支付方式」+ 建钱包时要能选支付方式，两处都需要
  // 这份清单。payment_method 跟人走不跟行程走，按 participant_id 查，不用管 tripId。
  const myPaymentMethods = await db
    .select()
    .from(paymentMethods)
    .where(paymentMethodOwnerFilter(identity));
  const paymentMethodLabelById = new Map(myPaymentMethods.map((m) => [m.id, m.label]));
  // 「本行程启用的支付方式」（2026-09-15 落地 Artifact Version 10 遗留缺口）：钱包卡
  // 「绑定支付方式」下拉/命名提示只给这趟行程勾了启用的选，不是名下全部——已经绑过
  // 某个之后被取消勾选的支付方式的钱包，`paymentMethodLabelById` 这份全量映射还留着，
  // 历史绑定的名字不会因为取消勾选就显示成"未知"。
  const enabledPaymentMethodIds = await loadEnabledPaymentMethodIds(db, params.tripId, identity);
  const enabledPaymentMethods = myPaymentMethods.filter((m) => enabledPaymentMethodIds.has(m.id));

  return (
    <main className="flex flex-col gap-6">
      {/* fix(2026-09-12 标题栏走查反馈)：行程名不在这里重复显示了——头部导航的
          TripSwitcher（layout.tsx）已经是这个行程唯一的大标题+切换入口，这里再放
          一次同样的名字纯粹是重复信息，删掉只留这页自己的补充信息（本位币/状态）。 */}
      <p className="text-[10px] text-muted">
        本位币 {trip.baseCurrency} · {STATUS_LABEL[trip.status] ?? trip.status}
      </p>

      {/* fix(2026-09-13 Artifact Version 10 落地，第四轮拍板)：净额 Hero 卡跟「我的钱包」
          拆回两张独立卡片（Artifact 本身就是 .hero + .wallet-block 两个分开的卡，第十六轮
          "合并成一张深色卡"的方案C这次被更新的拍板版本推翻）——钱包卡需要自己的三档
          色阶切换器，合并卡片没法自然装下这个交互，详见 wallet-card.tsx 顶部注释。 */}
      <section className="relative flex flex-col gap-1 overflow-hidden rounded-hero bg-hero-gradient p-[9px] text-white shadow-hero">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-hero-label">我的净额</span>
            <span
              className={`font-serif text-2xl font-medium tabular-nums tracking-tight ${
                myNet >= 0 ? 'text-positive-dk' : 'text-negative-dk'
              }`}
            >
              {myNet >= 0 ? '+' : '-'}
              {formatMoney(Math.abs(myNet), trip.baseCurrency)}
            </span>
            <span className="text-[10px] text-hero-label">
              {myNet >= 0 ? '该收回' : '该付出'} · {unsettledCount} 笔消费
            </span>
          </div>
          <Link
            href={`/trips/${trip.id}/settlement`}
            className="inline-flex min-h-[32px] shrink-0 items-center text-[9.5px] text-hero-label underline underline-offset-2"
          >
            查看结算明细 →
          </Link>
        </div>

        {/* 「我承担」区块（2026-09-16 新增，落地"机票/宝石消费明细"这个真功能，
            之前只是 Artifact demo 假数据，见 PENDING-DECISIONS 对应章节）——
            跟上面"我的净额"是两个不同的数字："我的净额"是付出减分摊的净额（该收/
            该付），这里是"我自己该承担多少钱"的毛份额，被标了 excludeFromSplit
            的消费（机票/宝石这类业务差旅成本默认如此）从主数字里摘出来、按分类
            单独成行，不影响上面的结算计算。myShareGroups 为空（这趟行程她自己
            一笔分摊份额都没有）时整块不渲染，避免空数据还占一块地方。 */}
        {hasAnyMyShare && (
          <div className="mt-1 flex flex-col gap-1 border-t border-white/15 pt-[7px]">
            <span className="text-[10px] text-hero-label">
              我承担 · {myShareIncludedLabel} · 已扣分摊份额
            </span>
            <span className="font-serif text-lg font-medium tabular-nums tracking-tight text-white">
              {formatMoney(myShareNet, trip.baseCurrency)}
            </span>
            <span className="text-[10px] text-hero-label">{myShareCount} 笔消费</span>

            <div className="mt-1 flex flex-col gap-[3px] rounded-[9px] bg-white/[.06] p-[7px]">
              <div className="flex items-center justify-between gap-2 text-[10px]">
                <span className="text-hero-label">{myShareIncludedLabel}</span>
                <span className="font-serif tabular-nums text-white">
                  净 {formatMoney(myShareNet, trip.baseCurrency)} · 毛{' '}
                  {formatMoney(myShareGross, trip.baseCurrency)}
                </span>
              </div>
              {myShareExcluded.map((g) => (
                <div key={g.category} className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="text-hero-label">
                    {g.category} ({g.count})
                  </span>
                  <span className="font-serif tabular-nums text-white">
                    净 {formatMoney(g.netBaseCurrency, trip.baseCurrency)} · 毛{' '}
                    {formatMoney(g.grossBaseCurrency, trip.baseCurrency)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <WalletCard
        tripId={trip.id}
        baseCurrency={trip.baseCurrency}
        myParticipantId={identity.participantId}
        participants={tripParticipants.map((p) => ({ id: p.id, displayName: p.displayName }))}
        wallets={myWallets.map((w) => ({
          id: w.id,
          label: w.label,
          currency: w.currency,
          emoji: w.emoji,
          currentBalance: w.currentBalance,
          paymentMethodId: w.paymentMethodId,
          linkedPaymentMethodLabel: w.paymentMethodId ? paymentMethodLabelById.get(w.paymentMethodId) ?? null : null,
        }))}
        paymentMethods={enabledPaymentMethods.map((m) => ({
          id: m.id,
          label: m.label,
          settlementCurrency: m.settlementCurrency,
        }))}
      />

      {/* 「新建钱包」表单的落点：WalletGrid 在 embedded-dark 模式下把表单 portal 到这里，
          让它渲染在深色钱包卡外面（浅色表单塞进深色卡里会看不清），设计稿没规格这段所以
          维持现有浅色表单样式，别自己发明深色版本。default 模式的 WalletGrid 用不到这个插槽。
          fix(2026-09-12 间距走查)：这个插槽收起时 height 是 0，但
          但 <main> 是 flex flex-col gap-6，gap 是加在"每一对相邻 flex item 之间"的，这个空插槽
          即使 0 高度依然算一个 item，会在钱包卡和它之间、它和 FxRateCard 之间各吃一份 gap-6。
          加 empty:hidden：插槽真的空的时候（:empty，无子节点）整个从 flex 布局摘掉，不再吃 gap；
          portal 挂表单进来后不再是 :empty，恢复参与 flex 布局正常显示，行为不变。 */}
      <div id="wallet-form-slot" className="empty:hidden" />

      <FxRateCard tripId={trip.id} baseCurrency={trip.baseCurrency} hasPaymentMethods={myPaymentMethods.length > 0} />

      <FxChannelCompareCard enabledCurrencies={trip.enabledCurrencies} />

      {/* fix(2026-09-14 Artifact Version 10 走查补做)：行程主页的「参与者」卡片整块删掉——
          Version 10 notes 原话是这个区块从行程主页删除，邀请管理页（参与者认领状态）跟
          结算页（净额清单/查看分摊明细）各自留着自己那份参与者名单不受影响，只是这里不再
          重复摆一份。删完这个区块，`tripParticipants`/`netBalances` 两份数据没有变成没用——
          `tripParticipants` 还要喂给 WalletCard 的参与者选择器和 ExpenseList 的 nameById，
          `netBalances` 还要算上面 Hero 卡的 myNet，都留着。 */}

      <section className="flex flex-col gap-2">
        <h2 className="text-[12.5px] font-semibold text-ink">活动流</h2>
        <ExpenseList
          tripId={trip.id}
          myParticipantId={identity.participantId}
          baseCurrency={trip.baseCurrency}
          expenses={tripExpenses.map((e) => ({
            id: e.id,
            category: e.category,
            merchant: e.merchant,
            amount: e.amount,
            currency: e.currency,
            // 排序/约算成本位币小字要用，见 expense-list.tsx。
            amountBaseCurrency: e.amountBaseCurrency,
            expenseDate: e.expenseDate.toISOString(),
            hasReceipt: e.receiptPath !== null,
            payerName: nameById.get(e.payerParticipantId) ?? '未知',
            enteredByParticipantId: e.enteredByParticipantId,
            // 支付方式筛选 chip 要用的标签：只有「我自己」录入的那些消费才查得到标签
            // （payment_method 归属私有，别人的 payment_method_id 我读不到是哪一张卡），
            // 别人录入的消费如果带了 paymentMethodId 也只能显示成"其他人的支付方式"。
            paymentMethodLabel: e.paymentMethodId
              ? paymentMethodLabelById.get(e.paymentMethodId) ?? '其他人的支付方式'
              : null,
            excludeFromSplit: e.excludeFromSplit,
          }))}
        />
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[12.5px] font-semibold text-ink">
            换汇 · <span className="font-mono text-[10px] uppercase tracking-wide">EXCHANGE</span>
          </h2>
          <span className="text-[10px] text-muted">仅自己可见</span>
        </div>
        <ExchangeRecordList
          records={myExchangeRecords.map((r) => ({
            id: r.id,
            fromLabel: r.fromWalletId ? walletById.get(r.fromWalletId)?.label ?? '未知钱包' : null,
            toLabel: walletById.get(r.toWalletId)?.label ?? '未知钱包',
            fromAmount: r.fromAmount,
            toAmount: r.toAmount,
            toCurrency: walletById.get(r.toWalletId)?.currency ?? '',
            fromCurrency: r.fromWalletId ? walletById.get(r.fromWalletId)?.currency ?? '' : '',
            exchangeDate: r.exchangeDate.toISOString(),
            note: r.note,
          }))}
        />
      </section>
    </main>
  );
}
