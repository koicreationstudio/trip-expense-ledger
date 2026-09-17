import { and, eq } from 'drizzle-orm';
import type { Db } from './client';
import { expenses, expenseSplits, settlementConfirmations } from './schema';
import type { SettlementExpenseInput } from '../domain/settlement';

/**
 * 结算是唯一允许跨参与者读取的查询，这里只查 settlement 算法需要的三个字段
 * （payer/金额/分摊），不带 note/category/receiptPath，从查询源头就不把私密字段
 * 拉进内存，而不是依赖后面响应时"记得别展开"。
 */
export async function loadSettlementInput(db: Db, tripId: string): Promise<SettlementExpenseInput[]> {
  const expenseRows = await db
    .select({
      id: expenses.id,
      payerParticipantId: expenses.payerParticipantId,
      amountBaseCurrency: expenses.amountBaseCurrency,
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

  return expenseRows.map((row) => ({
    payerParticipantId: row.payerParticipantId,
    amountBaseCurrency: row.amountBaseCurrency,
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

/** 返回这个行程里已经被标记"已收款"的转账对集合，key 是 `${from}:${to}`。 */
export async function loadConfirmedTransferPairs(db: Db, tripId: string): Promise<Set<string>> {
  const rows = await db
    .select({
      fromParticipantId: settlementConfirmations.fromParticipantId,
      toParticipantId: settlementConfirmations.toParticipantId,
    })
    .from(settlementConfirmations)
    .where(eq(settlementConfirmations.tripId, tripId));
  return new Set(rows.map((r) => `${r.fromParticipantId}:${r.toParticipantId}`));
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
