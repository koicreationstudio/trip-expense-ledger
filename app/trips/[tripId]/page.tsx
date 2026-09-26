import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import {
  exchangeRecords,
  expenses,
  expenseSplits,
  loanRepayments,
  loans,
  participants,
  paymentMethods,
  trips,
  wallets,
} from '@/lib/db/schema';
import { getCurrentIdentity } from '@/lib/auth/current-session';
import { loadMyShareBreakdown, loadSettlementInput } from '@/lib/db/settlement-query';
import { computeNetBalances } from '@/lib/domain/settlement';
import { computeLoanProgress } from '@/lib/domain/loan';
import { isOnlyMeSplit } from '@/lib/domain/expense-split-mode';
import { formatMoney } from '@/lib/money';
import { deriveMidRate, ensureMyrRatesFresh, getMyrRateSnapshot } from '@/lib/fx/rate-cache';
import { ExpenseList } from './expense-list';
import { WalletCard } from './wallet-card';
import { ExchangeRecordList } from './exchange-record-list';
import { LoanList } from './loans/loan-list';
import { FxCompareCard } from './fx-compare-card';
import { loadEnabledPaymentMethodIds, paymentMethodOwnerFilter } from '@/lib/domain/payment-method-scope';
import { computeWalletDisplayBalances } from '@/lib/domain/wallet-balance';
import { disambiguatePaymentMethodLabels } from '@/lib/domain/payment-method-label';

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

  // 「计分摊/不计分摊」判定要用的 splits 参与人清单（这次命名纠正任务新增）：
  // 一次查询批量拿这趟行程全部消费的 expense_split 行，按 expenseId 分组成
  // "这笔消费分给了哪些 participantId"，再用 `isOnlyMeSplit` 算出"是不是只分
  // 给了付款人自己"——不逐笔查询（N+1），一次查完这趟行程全部消费对应的
  // split 行就够了。某笔消费查不到任何 split 行（异常情况，正常流程 splits
  // 一定至少有 1 行）时 Map 里没有这个 key，下面兜底给 false，不阻塞渲染。
  const tripExpenseIds = tripExpenses.map((e) => e.id);
  const splitParticipantIdsByExpenseId = new Map<string, string[]>();
  if (tripExpenseIds.length > 0) {
    const splitRows = await db
      .select({ expenseId: expenseSplits.expenseId, participantId: expenseSplits.participantId })
      .from(expenseSplits)
      .where(inArray(expenseSplits.expenseId, tripExpenseIds));
    for (const row of splitRows) {
      const list = splitParticipantIdsByExpenseId.get(row.expenseId);
      if (list) {
        list.push(row.participantId);
      } else {
        splitParticipantIdsByExpenseId.set(row.expenseId, [row.participantId]);
      }
    }
  }
  const isOnlyMeSplitByExpenseId = new Map<string, boolean>();
  for (const e of tripExpenses) {
    const splitParticipantIds = splitParticipantIdsByExpenseId.get(e.id) ?? [];
    isOnlyMeSplitByExpenseId.set(e.id, isOnlyMeSplit(splitParticipantIds, e.payerParticipantId));
  }

  // 活动流"约算金额"要用的本位币→MYR中间汇率（2026-09-19 第二十八轮新增）：
  // 只在本位币不是 MYR 时才需要，本位币就是 MYR 的行程约算等于自己换算自己没意义，
  // 也省一次不必要的缓存查询。`ensureMyrRatesFresh`/`getMyrRateSnapshot` 是
  // lib/fx/rate-cache.ts 现成的共享 chokepoint（汇率比价卡那两个 API 路由已经在用），
  // 这里复用同一份缓存/换算规则，不是另起一套。缓存/上游接口暂时拿不到这个币种的
  // 汇率时 `baseCurrencyToMyrRate` 是 undefined，下面每笔消费的 `amountMyr` 会是
  // null，ExpenseList 那边看到 null 就不显示约算行，不会拿一个凑出来的假数字。
  let baseCurrencyToMyrRate: number | undefined;
  if (trip.baseCurrency !== 'MYR') {
    await ensureMyrRatesFresh(db, false);
    const myrSnapshot = await getMyrRateSnapshot(db);
    baseCurrencyToMyrRate = deriveMidRate(myrSnapshot.rates, trip.baseCurrency, 'MYR');
  }

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

  // 借款清单（round72b 新增）：跟 expense/exchangeRecord 完全独立的一张新表，
  // 私密边界是"我是当事人之一（lender 或 borrower）"，不是"我自己名下"（loan
  // 天然是两个人的事），也不是"整个行程都能看"（跟 activity 流那种共享可见度
  // 不是同一档），具体口径见 app/api/trips/[tripId]/loans/route.ts 顶部注释。
  const myLoans = await db
    .select()
    .from(loans)
    .where(
      and(
        eq(loans.tripId, params.tripId),
        or(eq(loans.lenderParticipantId, identity.participantId), eq(loans.borrowerParticipantId, identity.participantId))
      )
    )
    .orderBy(desc(loans.date));

  const loanIds = myLoans.map((l) => l.id);
  const loanRepaymentSums = new Map<string, number>();
  if (loanIds.length > 0) {
    const sumRows = await db
      .select({ loanId: loanRepayments.loanId, total: sql<number>`coalesce(sum(${loanRepayments.amount}), 0)` })
      .from(loanRepayments)
      .where(inArray(loanRepayments.loanId, loanIds))
      .groupBy(loanRepayments.loanId);
    for (const row of sumRows) loanRepaymentSums.set(row.loanId, Number(row.total));
  }

  // fix(2026-09-24 第五十轮，"设置当前余额"覆盖式 bug 修复)：行程主页「我的钱包」
  // 这里是直接查 DB 拿 `w.currentBalance` 原始存储值，不经过 wallets/route.ts 那个
  // API 路由，所以那边的推导修复不会自动覆盖到这里——两处都要各自调
  // computeWalletDisplayBalance，不然会出现"支付方式页显示对了、行程主页还是
  // 旧数字"这种两处不一致的回归（见 lib/domain/wallet-balance.ts 顶部大段注释）。
  const walletDisplayBalances = await computeWalletDisplayBalances(db, myWallets);

  // 钱包卡片上要能显示「绑了哪个支付方式」+ 建钱包时要能选支付方式，两处都需要
  // 这份清单。payment_method 跟人走不跟行程走，按 participant_id 查，不用管 tripId。
  const myPaymentMethods = await db
    .select()
    .from(paymentMethods)
    .where(paymentMethodOwnerFilter(identity));
  // fix(2026-09-24 第五十八轮，Remy 真实反馈"现金/现金分不清是哪个")：原本这里是
  // 原样 `m.label` 的映射，名下多个支付方式同名(比如"现金"HKD结算 + "现金"USD结算)
  // 时，钱包卡"绑了哪个支付方式"、活动流简写、活动流"支付方式：全部"筛选下拉三处
  // 全部分不清是哪一个。改用 `disambiguatePaymentMethodLabels` 这个 chokepoint——
  // 只有这一组里真的重复的 label 才追加币种后缀，唯一的 label 保持原样。
  const paymentMethodLabelById = disambiguatePaymentMethodLabels(myPaymentMethods);
  // 「本行程启用的支付方式」（2026-09-15 落地 Artifact Version 10 遗留缺口）：钱包卡
  // 「绑定支付方式」下拉/命名提示只给这趟行程勾了启用的选，不是名下全部——已经绑过
  // 某个之后被取消勾选的支付方式的钱包，`paymentMethodLabelById` 这份全量映射还留着，
  // 历史绑定的名字不会因为取消勾选就显示成"未知"。
  const enabledPaymentMethodIds = await loadEnabledPaymentMethodIds(db, params.tripId, identity);
  const enabledPaymentMethods = myPaymentMethods.filter((m) => enabledPaymentMethodIds.has(m.id));

  // 「本行程已开启，但还没建对应钱包」的支付方式（2026-09-24 第五十八轮，Remy 真实
  // 反馈"我的钱包区块看不出还有已启用但没建钱包的支付方式"）——判断逻辑照抄
  // `payment-methods-manager.tsx` 的 `missingWalletMethods`（同一条规则，不重新发明），
  // 卡类/现金类一视同仁不按 `kind` 过滤，理由同该文件那段注释：「钱包」这个概念本来
  // 就不分卡/现金。
  const walletPaymentMethodIds = new Set(
    myWallets.map((w) => w.paymentMethodId).filter((id): id is string => id !== null)
  );
  const missingWalletMethods = enabledPaymentMethods.filter((m) => !walletPaymentMethodIds.has(m.id));

  return (
    // fix(2026-09-16 第十七轮)：gap-6(24px) 太松——Artifact 卡片间距量出来是 10-14px 这个
    // 量级（.hero/.wallet-block/.quickadd 各自 margin-bottom:10px，.fx-section 14px），
    // 收到 gap-2.5(10px) 对齐这套紧凑化基调，不再是页面上每张卡都隔老远。
    <main className="flex flex-col gap-2.5">
      {/* fix(2026-09-16 第十七轮)：这行"本位币 HKD·记账中"重复文案删掉了——不是"这条信息
          该不该展示"的产品判断，是这条信息已经在头部大标题下面显示过一次了（layout.tsx
          的 TripHeaderNav，Artifact `.title-block p` 本来就是这一行"本位币 MYR · 记账中"，
          从来不是独立 subheader）。之前这里又插一遍，加上 header 那边还多了条
          `border-b`分隔线，凑成了 Remy 截图里"多出一条线+一行字"那组差异。真代码库
          之前这份注释说"头部已经是唯一大标题"，但漏看了头部那份副标题其实跟这里是
          同一句话，两处各写各的，是真的重复，不是需要问她要不要保留的模糊地带。 */}
      {/* fix(2026-09-13 Artifact Version 10 落地，第四轮拍板)：净额 Hero 卡跟「我的钱包」
          拆回两张独立卡片（Artifact 本身就是 .hero + .wallet-block 两个分开的卡，第十六轮
          "合并成一张深色卡"的方案C这次被更新的拍板版本推翻）——钱包卡需要自己的三档
          色阶切换器，合并卡片没法自然装下这个交互，详见 wallet-card.tsx 顶部注释。 */}
      <section className="relative flex flex-col gap-1 overflow-hidden rounded-hero bg-hero-gradient p-[9px] text-white shadow-hero">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex flex-col gap-1">
            {/* fix(2026-09-17 第二十轮)：round15 曾以"这个数字可正可负，'消费总金额'
                听起来该是正数"为由把这行标签改成"我的净额"，round19 交给 Remy 确认，
                她这轮明确表态"照方案原文改，不要保留论证"——改回 Artifact V10 原文
                "消费总金额"，不再自行论证语义对不对。下面数字本身（myNet，正负号+颜色）
                完全没动，只改这行标签文字。 */}
            <span className="text-[10px] uppercase tracking-wide text-hero-label">消费总金额</span>
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
          {/* fix(2026-09-16 第十七轮，坐实 round16 留下的那条差距)：Artifact `.link-btn`
              是 `background:rgba(255,255,255,.16); padding:4px 9px; border-radius:999px;
              text-decoration:none` 的深色小胶囊，不是下划线文字——DESIGN-BRIEF.md 第 669
              行也是这么写的，round16 已经查过是真差距只是没人动手改，这次直接照 Artifact
              数值改掉，不再是悬案。 */}
          <Link
            href={`/trips/${trip.id}/settlement`}
            className="inline-flex shrink-0 items-center rounded-full bg-white/[.16] px-[9px] py-1 text-[10px] font-medium text-white"
          >
            查看结算明细 →
          </Link>
        </div>

        {/* 「我承担」区块（2026-09-16 新增，落地"机票/宝石消费明细"这个真功能，
            之前只是 Artifact demo 假数据，见 PENDING-DECISIONS 对应章节）——
            跟上面"消费总金额"是两个不同的数字：上面那个是付出减分摊的净额（该收/
            该付），这里是"我自己该承担多少钱"的毛份额，被标了 excludeFromSplit
            的消费（机票/宝石这类业务差旅成本默认如此）从主数字里摘出来、按分类
            单独成行，不影响上面的结算计算。myShareGroups 为空（这趟行程她自己
            一笔分摊份额都没有）时整块不渲染，避免空数据还占一块地方。 */}
        {hasAnyMyShare && (
          <div className="mt-1 flex flex-col gap-1 border-t border-white/15 pt-[7px]">
            {/* fix(2026-09-16 第十五轮)：没有 excludeFromSplit 分类时 myShareIncludedLabel
                退化成"我承担的消费"，直接拼进这行会变成"我承担 · 我承担的消费 · 已扣分摊份额"，
                同一个意思说两遍。只有真的有排除分类（"不含机票、宝石"这种）时才值得在标题行
                里再报一次是什么，没有排除分类就不重复这段，行内的分类明细（下面 {myShareIncludedLabel}
                那一行）不受影响，那里单独出现"我承担的消费"作为一行的行首标签是合理的。 */}
            <span className="text-[10px] text-hero-label">
              我承担{myShareExcluded.length > 0 ? ` · ${myShareIncludedLabel}` : ''} · 已扣分摊份额
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
          currentBalance: walletDisplayBalances.get(w.id) ?? w.currentBalance,
          paymentMethodId: w.paymentMethodId,
          linkedPaymentMethodLabel: w.paymentMethodId ? paymentMethodLabelById.get(w.paymentMethodId) ?? null : null,
        }))}
        paymentMethods={enabledPaymentMethods.map((m) => ({
          id: m.id,
          label: m.label,
          settlementCurrency: m.settlementCurrency,
        }))}
        missingWalletMethods={missingWalletMethods.map((m) => ({
          id: m.id,
          label: m.label,
          kind: m.kind,
          settlementCurrency: m.settlementCurrency,
        }))}
      />

      {/* fix(2026-09-16 第十八轮，Remy 拍板"要根治")：原本两张独立卡片（当前汇率比价/
          换汇渠道比价）合并成 Artifact V10 的单卡结构，两边查询能力都保留——具体怎么
          在一张卡里装下两种比价逻辑，见 fx-compare-card.tsx 顶部大段注释。 */}
      <FxCompareCard
        tripId={trip.id}
        baseCurrency={trip.baseCurrency}
        hasPaymentMethods={myPaymentMethods.length > 0}
        enabledCurrencies={trip.enabledCurrencies}
      />

      {/* fix(2026-09-14 Artifact Version 10 走查补做)：行程主页的「参与者」卡片整块删掉——
          Version 10 notes 原话是这个区块从行程主页删除，邀请管理页（参与者认领状态）跟
          结算页（净额清单/查看分摊明细）各自留着自己那份参与者名单不受影响，只是这里不再
          重复摆一份。删完这个区块，`tripParticipants`/`netBalances` 两份数据没有变成没用——
          `tripParticipants` 还要喂给 WalletCard 的参与者选择器和 ExpenseList 的 nameById，
          `netBalances` 还要算上面 Hero 卡的 myNet，都留着。 */}

      <section className="flex flex-col gap-2">
        {/* fix(2026-09-16 第十八轮)：小标题样式统一成 Artifact `section.blk h4` 规格
            （10px/neutral-dk/letter-spacing），文案"活动流"本身是 Remy 更早一轮的原话
            要求（盖过 Artifact"记录·HISTORY"），这次只改样式不改字。 */}
        <h2 className="text-[10px] font-medium tracking-[0.08em] text-neutral-dk">活动流</h2>
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
            // 排序要用，见 expense-list.tsx。
            amountBaseCurrency: e.amountBaseCurrency,
            // 活动流"约算金额"行要用（见 expense-list.tsx ExpenseListItem.amountMyr
            // 字段注释）：本位币是 MYR 或者汇率暂时拿不到时是 null。
            amountMyr:
              baseCurrencyToMyrRate !== undefined
                ? Math.round(e.amountBaseCurrency * baseCurrencyToMyrRate)
                : null,
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
            // 「计分摊/不计分摊」筛选真正依据的推导字段（这次命名纠正任务新增，
            // 见上面 isOnlyMeSplitByExpenseId 的算法注释）——跟 excludeFromSplit
            // 是两个独立维度，不要混用。
            isOnlyMeSplit: isOnlyMeSplitByExpenseId.get(e.id) ?? false,
            sortOrder: e.sortOrder,
          }))}
        />
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[10px] font-medium tracking-[0.08em] text-neutral-dk">
            换汇 · <span className="font-mono uppercase tracking-wide">EXCHANGE</span>
          </h2>
          <span className="text-[10px] text-muted">仅自己可见</span>
        </div>
        <ExchangeRecordList
          tripId={trip.id}
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

      {/* 借款清单（round72b 新增）："仅当事人可见"，不是整个行程共享，见上面查询
          处的注释。跟 expense/exchangeRecord 是三个平级的独立区块，不参与 Hero
          卡"我承担"、活动流、结算净额这几处既有计算。
          fix(round72 批次②，ui-auditor 抓到的真 bug)：底部"＋"菜单里"记一笔还钱"
          点了跳 `#loans`（见 record-expense-bar.tsx 注释——还钱要先挑是哪一笔
          欠款，落地位置是这个区块，不整一个只填金额、猜是哪笔的独立表单），但这个
          section 之前没有 `id="loans"`，浏览器 hash 跳转找不到目标锚点，点了完全
          没反应（URL 变了，页面纹丝不动），用户会以为点击没生效。这里补上 id，
          恢复原生锚点跳转；没有借出记录时下面 LoanList 自己有空状态文案会跟着
          一起被滚进视口，不用再额外写"还没有可还的借款"这类专属提示。 */}
      <section id="loans" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[10px] font-medium tracking-[0.08em] text-neutral-dk">
            借还款 · <span className="font-mono uppercase tracking-wide">LOANS</span>
          </h2>
          <span className="text-[10px] text-muted">仅当事人可见</span>
        </div>
        <LoanList
          tripId={trip.id}
          loans={myLoans.map((l) => ({
            id: l.id,
            lenderName: nameById.get(l.lenderParticipantId) ?? '未知',
            borrowerName: nameById.get(l.borrowerParticipantId) ?? '未知',
            amount: l.amount,
            currency: l.currency,
            date: l.date.toISOString(),
            note: l.note,
            progress: computeLoanProgress(l.amount, [{ amount: loanRepaymentSums.get(l.id) ?? 0 }]),
          }))}
          wallets={myWallets.map((w) => ({ id: w.id, label: w.label, currency: w.currency, emoji: w.emoji }))}
        />
      </section>
    </main>
  );
}
