import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { expenses, expenseSplits } from './schema';
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
