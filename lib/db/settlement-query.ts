import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from './client';
import { expenses, expenseSplits, settlementConfirmations } from './schema';
import type { SettlementExpenseInput, SettlementExpenseInputWithCurrency } from '../domain/settlement';

/**
 * 结算是唯一允许跨参与者读取的查询，这里只查 settlement 算法需要的三个字段
 * （payer/金额/分摊），不带 note/category/receiptPath，从查询源头就不把私密字段
 * 拉进内存，而不是依赖后面响应时"记得别展开"。
 *
 * fix(2026-09-24 第三十九轮，团队看板反馈 N+1)：真正干活的是下面
 * `loadSettlementInputForTrips`（批量版，一次查全部行程），这个单行程版本只是
 * 套一层薄壳（传 `[tripId]` 再从返回的 Map 里取一条），两个函数背后是同一份查询
 * 逻辑，不是两份互相漂移的实现——`app/trips/[tripId]/settlement/page.tsx` 等只需要
 * 单趟行程结算结果的调用方continue 用这个签名不用改。
 */
export async function loadSettlementInput(db: Db, tripId: string): Promise<SettlementExpenseInput[]> {
  const byTripId = await loadSettlementInputForTrips(db, [tripId]);
  return byTripId.get(tripId) ?? [];
}

/**
 * fix(2026-09-24 第三十九轮，团队看板 id=2026-09-23_232430_18dcf425)：
 * `loadUserTripsWithBalance`（`user-trips-query.ts`）消费总额那段本来就是一次分组
 * 聚合查全部行程（list-once 纪律），但紧接着对每趟行程又调一次
 * `loadSettlementInput` 算净额——每趟行程各起 2 条独立查询（expenses + splits
 * join），是同一个函数里自己打自己脸的 N+1。改成这个批量版本：不管有几趟行程，
 * 固定 2 条查询（`inArray(tripId, tripIds)`），查完在内存里按 tripId 分组，
 * 调用方从 Map 里按需取，行程数再多也不会线性变慢。
 */
export async function loadSettlementInputForTrips(
  db: Db,
  tripIds: string[]
): Promise<Map<string, SettlementExpenseInput[]>> {
  if (tripIds.length === 0) return new Map();

  const expenseRows = await db
    .select({
      id: expenses.id,
      tripId: expenses.tripId,
      payerParticipantId: expenses.payerParticipantId,
      amountBaseCurrency: expenses.amountBaseCurrency,
    })
    .from(expenses)
    .where(inArray(expenses.tripId, tripIds));

  const splitRows = await db
    .select({
      expenseId: expenseSplits.expenseId,
      participantId: expenseSplits.participantId,
      shareAmountBaseCurrency: expenseSplits.shareAmountBaseCurrency,
    })
    .from(expenseSplits)
    .innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id))
    .where(inArray(expenses.tripId, tripIds));

  const splitsByExpenseId = new Map<string, { participantId: string; shareAmountBaseCurrency: number }[]>();
  for (const row of splitRows) {
    const list = splitsByExpenseId.get(row.expenseId) ?? [];
    list.push({ participantId: row.participantId, shareAmountBaseCurrency: row.shareAmountBaseCurrency });
    splitsByExpenseId.set(row.expenseId, list);
  }

  const byTripId = new Map<string, SettlementExpenseInput[]>();
  for (const row of expenseRows) {
    const list = byTripId.get(row.tripId) ?? [];
    list.push({
      payerParticipantId: row.payerParticipantId,
      amountBaseCurrency: row.amountBaseCurrency,
      splits: splitsByExpenseId.get(row.id) ?? [],
    });
    byTripId.set(row.tripId, list);
  }
  return byTripId;
}

/**
 * "结算按币种拆开显示"用（2026-09-26）：跟 loadSettlementInput 同一份查询
 * 纪律（只查算法需要的字段，不带 note/category/receiptPath），多查
 * expense.currency/amount + expenseSplits.shareAmountOriginal 这两组"原始币种"
 * 字段，供 computeSettlementByCurrency 按币种分组精确算净额用。只做单趟行程版本
 * （不像 loadSettlementInputForTrips 那样批量）——目前只有结算页这一处调用，
 * 用不到跨行程批量查询。
 */
export async function loadSettlementInputWithCurrency(
  db: Db,
  tripId: string
): Promise<SettlementExpenseInputWithCurrency[]> {
  const expenseRows = await db
    .select({
      id: expenses.id,
      payerParticipantId: expenses.payerParticipantId,
      amountBaseCurrency: expenses.amountBaseCurrency,
      currency: expenses.currency,
      amount: expenses.amount,
    })
    .from(expenses)
    .where(eq(expenses.tripId, tripId));

  const splitRows = await db
    .select({
      expenseId: expenseSplits.expenseId,
      participantId: expenseSplits.participantId,
      shareAmountBaseCurrency: expenseSplits.shareAmountBaseCurrency,
      shareAmountOriginal: expenseSplits.shareAmountOriginal,
    })
    .from(expenseSplits)
    .innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id))
    .where(eq(expenses.tripId, tripId));

  const splitsByExpenseId = new Map<
    string,
    { participantId: string; shareAmountBaseCurrency: number; shareAmountOriginal: number }[]
  >();
  for (const row of splitRows) {
    const list = splitsByExpenseId.get(row.expenseId) ?? [];
    list.push({
      participantId: row.participantId,
      shareAmountBaseCurrency: row.shareAmountBaseCurrency,
      shareAmountOriginal: row.shareAmountOriginal,
    });
    splitsByExpenseId.set(row.expenseId, list);
  }

  return expenseRows.map((row) => ({
    currency: row.currency,
    payerParticipantId: row.payerParticipantId,
    amountBaseCurrency: row.amountBaseCurrency,
    amountOriginal: row.amount,
    splits: splitsByExpenseId.get(row.id) ?? [],
  }));
}

export interface SettlementDetailEntry {
  expenseId: string;
  category: string;
  // 商家名称，纯展示用（2026-09-18 补上）：Remy 反馈"查看 XX 的分摊明细"只显示
  // 分类（比如"餐饮"），同一天好几笔餐饮分不清是哪一笔，要跟活动流一样看到具体
  // 商家名。可空——历史/手动录入的部分消费没有填过商家名，这些行照旧只显示分类。
  merchant: string | null;
  expenseDate: string; // ISO
  amountBaseCurrency: number; // 带符号：垫付=正，分摊份额=负
  role: 'paid' | 'shared';
  // 2026-09-16 新增，纯展示用：这笔是不是被标了"不计入 Hero 卡我承担合计"，
  // 不影响这里任何净值/结算计算（那部分只看 splits，跟这个字段无关）。
  excludeFromSplit: boolean;
}

/**
 * 结算页"查看 XX 的分摊明细 ▾"展开功能用（2026-09-13 落地第四轮拍板屏④，之前
 * 完全没有这个功能，是新做的，不是样式微调）。每个参与者名下列出跟他净值相关
 * 的每一笔消费：他代垫的（role='paid'，正数）+ 他要分摊的份额（role='shared'，
 * 负数），带 category/商家名/日期/金额——跟 loadSettlementInput 同一条纪律，
 * 结算算法本身（loadSettlementInput）不带任何展示性字段。
 * 2026-09-18 补记：merchant 曾经也被当成 note/receiptPath 那类私密字段排除在外，
 * 但查证 expense-list.tsx（活动流）本来就把商家名展示给整个行程所有参与者看
 * （只有 paymentMethodLabel 才是真的按录入人做隐私区分），这条排除跟全站其它
 * 地方的实际做法不一致，不是刻意维护的隐私边界，这次按 Remy 要求把它加回来，
 * 跟活动流用同一套"商家名优先，没填退回分类"的展示规则（见 settlement-body.tsx）。
 */
export async function loadSettlementDetail(db: Db, tripId: string): Promise<Map<string, SettlementDetailEntry[]>> {
  const expenseRows = await db
    .select({
      id: expenses.id,
      payerParticipantId: expenses.payerParticipantId,
      amountBaseCurrency: expenses.amountBaseCurrency,
      category: expenses.category,
      merchant: expenses.merchant,
      expenseDate: expenses.expenseDate,
      excludeFromSplit: expenses.excludeFromSplit,
    })
    .from(expenses)
    .where(eq(expenses.tripId, tripId));

  const splitRows = await db
    .select({
      expenseId: expenseSplits.expenseId,
      participantId: expenseSplits.participantId,
      shareAmountBaseCurrency: expenseSplits.shareAmountBaseCurrency,
    })
    .from(expenseSplits)
    .innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id))
    .where(eq(expenses.tripId, tripId));

  const splitsByExpenseId = new Map<string, { participantId: string; shareAmountBaseCurrency: number }[]>();
  for (const row of splitRows) {
    const list = splitsByExpenseId.get(row.expenseId) ?? [];
    list.push({ participantId: row.participantId, shareAmountBaseCurrency: row.shareAmountBaseCurrency });
    splitsByExpenseId.set(row.expenseId, list);
  }

  const detailByParticipant = new Map<string, SettlementDetailEntry[]>();
  const push = (participantId: string, entry: SettlementDetailEntry) => {
    const list = detailByParticipant.get(participantId) ?? [];
    list.push(entry);
    detailByParticipant.set(participantId, list);
  };

  for (const row of expenseRows) {
    push(row.payerParticipantId, {
      expenseId: row.id,
      category: row.category,
      merchant: row.merchant,
      expenseDate: row.expenseDate.toISOString(),
      amountBaseCurrency: row.amountBaseCurrency,
      role: 'paid',
      excludeFromSplit: row.excludeFromSplit,
    });
    for (const split of splitsByExpenseId.get(row.id) ?? []) {
      push(split.participantId, {
        expenseId: row.id,
        category: row.category,
        merchant: row.merchant,
        expenseDate: row.expenseDate.toISOString(),
        amountBaseCurrency: -split.shareAmountBaseCurrency,
        role: 'shared',
        excludeFromSplit: row.excludeFromSplit,
      });
    }
  }

  return detailByParticipant;
}

/**
 * 返回这个行程里已经被标记"已收款"的转账集合，key 是 `${from}:${to}:${currency}`。
 *
 * fix(2026-09-26，"结算按币种拆开显示")：key 加上 currency——只精确匹配具体币种，
 * 这次上线前的历史遗留行（currency IS NULL，见 schema.ts 大注释）不会被当成
 * "匹配任何币种都算已收款"混进来，也不会被直接丢弃。这意味着：那些历史遗留行
 * 在没跑 scripts/backfill-settlement-confirmation-currency.ts 之前，不会让任何
 * 新的按币种分行显示成"已收款"（每个币种分行都要重新勾一次）——这是刻意的保守
 * 选择（宁可多显示"未收款"提示 Remy 重新核对一遍，也不要让还没收到的某个币种
 * 被误判成"收了"），具体影响写在交接汇报里，不在这里自己拍板要不要跑那个迁移。
 */
export async function loadConfirmedTransferPairs(db: Db, tripId: string): Promise<Set<string>> {
  const rows = await db
    .select({
      fromParticipantId: settlementConfirmations.fromParticipantId,
      toParticipantId: settlementConfirmations.toParticipantId,
      currency: settlementConfirmations.currency,
    })
    .from(settlementConfirmations)
    .where(eq(settlementConfirmations.tripId, tripId));
  return new Set(
    rows.filter((r) => r.currency !== null).map((r) => `${r.fromParticipantId}:${r.toParticipantId}:${r.currency}`)
  );
}

export interface MyShareGroup {
  // excludeFromSplit=false 的那一组，category 传空字符串（合并成单独一组，
  // 不再细分分类）；excludeFromSplit=true 按各自 category 各起一组。
  category: string;
  excludeFromSplit: boolean;
  count: number;
  // 净：这个参与者在这一组里实际要承担的份额总和（她自己的 split 份额）。
  netBaseCurrency: number;
  // 毛：这一组消费本身的原始总额，不管怎么分摊，跟净是否相等取决于有没有
  // splits——见 lib/db/schema.ts expenses.excludeFromSplit 注释。
  grossBaseCurrency: number;
}

/**
 * 行程主页 Hero 卡"我承担"区块用（2026-09-16 新增）：只统计这个参与者真的有
 * 分摊份额的那些消费（她不在某笔消费的 splits 里，说明这笔跟她无关，不计入），
 * 按 excludeFromSplit 分组——false 的全部合并成一组（对应 Hero 卡主数字），
 * true 的按 category 各自一组（对应机票/宝石这类明细行，不写死具体分类名，
 * 任何分类只要有消费被标了 excludeFromSplit=true 都会在这里单独成一组）。
 */
export async function loadMyShareBreakdown(db: Db, tripId: string, participantId: string): Promise<MyShareGroup[]> {
  const expenseRows = await db
    .select({
      id: expenses.id,
      category: expenses.category,
      excludeFromSplit: expenses.excludeFromSplit,
      amountBaseCurrency: expenses.amountBaseCurrency,
    })
    .from(expenses)
    .where(eq(expenses.tripId, tripId));

  const myShareRows = await db
    .select({
      expenseId: expenseSplits.expenseId,
      shareAmountBaseCurrency: expenseSplits.shareAmountBaseCurrency,
    })
    .from(expenseSplits)
    .innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id))
    .where(and(eq(expenses.tripId, tripId), eq(expenseSplits.participantId, participantId)));

  const myShareByExpenseId = new Map(myShareRows.map((r) => [r.expenseId, r.shareAmountBaseCurrency]));

  const groups = new Map<
    string,
    { category: string; excludeFromSplit: boolean; count: number; net: number; gross: number }
  >();

  for (const row of expenseRows) {
    const myShare = myShareByExpenseId.get(row.id);
    if (myShare === undefined) continue; // 这笔的分摊名单里没有我，跟我无关

    const key = row.excludeFromSplit ? `excl:${row.category}` : 'incl';
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.net += myShare;
      existing.gross += row.amountBaseCurrency;
    } else {
      groups.set(key, {
        category: row.excludeFromSplit ? row.category : '',
        excludeFromSplit: row.excludeFromSplit,
        count: 1,
        net: myShare,
        gross: row.amountBaseCurrency,
      });
    }
  }

  return [...groups.values()].map((g) => ({
    category: g.category,
    excludeFromSplit: g.excludeFromSplit,
    count: g.count,
    netBaseCurrency: g.net,
    grossBaseCurrency: g.gross,
  }));
}
