import { and, desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import { exchangeRecords, expenses, participants, paymentMethods, trips, wallets } from '@/lib/db/schema';
import { getCurrentIdentity } from '@/lib/auth/current-session';
import { loadSettlementInput } from '@/lib/db/settlement-query';
import { computeNetBalances } from '@/lib/domain/settlement';
import { formatMoney } from '@/lib/money';
import { ExpenseList } from './expense-list';
import { WalletCard } from './wallet-card';
import { ExchangeRecordList } from './exchange-record-list';
import { FxRateCard } from './fx-rate-card';
import { FxChannelCompareCard } from './fx-channel-compare-card';
import { paymentMethodOwnerFilter } from '@/lib/domain/payment-method-scope';

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
        paymentMethods={myPaymentMethods.map((m) => ({
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
          expenses={tripExpenses.map((e) => ({
            id: e.id,
            category: e.category,
            merchant: e.merchant,
            amount: e.amount,
            currency: e.currency,
            expenseDate: e.expenseDate.toISOString(),
            hasReceipt: e.receiptPath !== null,
            payerName: nameById.get(e.payerParticipantId) ?? '未知',
            enteredByParticipantId: e.enteredByParticipantId,
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
