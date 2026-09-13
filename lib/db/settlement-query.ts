import { eq } from 'drizzle-orm';
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
  expenseDate: string; // ISO
  amountBaseCurrency: number; // 带符号：垫付=正，分摊份额=负
  role: 'paid' | 'shared';
}

/**
 * 结算页"查看 XX 的分摊明细 ▾"展开功能用（2026-09-13 落地第四轮拍板屏④，之前
 * 完全没有这个功能，是新做的，不是样式微调）。每个参与者名下列出跟他净值相关
 * 的每一笔消费：他代垫的（role='paid'，正数）+ 他要分摊的份额（role='shared'，
 * 负数），只带 category/日期/金额三个字段——跟 loadSettlementInput 同一条纪律，
 * 结算相关查询不带 note/merchant/receiptPath 这类私密字段。
 */
export async function loadSettlementDetail(db: Db, tripId: string): Promise<Map<string, SettlementDetailEntry[]>> {
  const expenseRows = await db
    .select({
      id: expenses.id,
      payerParticipantId: expenses.payerParticipantId,
      amountBaseCurrency: expenses.amountBaseCurrency,
      category: expenses.category,
      expenseDate: expenses.expenseDate,
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
      expenseDate: row.expenseDate.toISOString(),
      amountBaseCurrency: row.amountBaseCurrency,
      role: 'paid',
    });
    for (const split of splitsByExpenseId.get(row.id) ?? []) {
      push(split.participantId, {
        expenseId: row.id,
        category: row.category,
        expenseDate: row.expenseDate.toISOString(),
        amountBaseCurrency: -split.shareAmountBaseCurrency,
        role: 'shared',
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
