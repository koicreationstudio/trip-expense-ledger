import { and, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import { expenses, participants, trips } from '@/lib/db/schema';
import { getCurrentIdentity } from '@/lib/auth/current-session';
import { ExpenseForm } from '../../expense-form';

/**
 * 只有自己录入的消费才能编辑：查询条件直接把 enteredByParticipantId 焊死在
 * WHERE 里，跟 API 层 loadOwnExpense 用同一个权限原则——不是自己的一律
 * redirect 回行程主页，不区分「不存在」和「是别人的」。
 */
export default async function EditExpensePage({
  params,
}: {
  params: { tripId: string; expenseId: string };
}) {
  const identity = await getCurrentIdentity();
  if (!identity || identity.tripId !== params.tripId) {
    redirect('/');
  }

  const db = await getDb();
  const trip = await db.query.trips.findFirst({ where: eq(trips.id, params.tripId) });
  if (!trip) {
    redirect('/');
  }

  const expense = await db.query.expenses.findFirst({
    where: and(eq(expenses.id, params.expenseId), eq(expenses.tripId, params.tripId)),
    with: { splits: true },
  });
  if (!expense || expense.enteredByParticipantId !== identity.participantId) {
    redirect(`/trips/${params.tripId}`);
  }

  const tripParticipants = await db.select().from(participants).where(eq(participants.tripId, params.tripId));

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">编辑消费</h1>
      <ExpenseForm
        tripId={trip.id}
        baseCurrency={trip.baseCurrency}
        myParticipantId={identity.participantId}
        participants={tripParticipants.map((p) => ({ id: p.id, displayName: p.displayName }))}
        initialExpense={{
          id: expense.id,
          amount: expense.amount,
          currency: expense.currency,
          payerParticipantId: expense.payerParticipantId,
          category: expense.category,
          note: expense.note,
          expenseDate: expense.expenseDate.toISOString(),
          fxRateUsed: expense.fxRateUsed,
          amountBaseCurrency: expense.amountBaseCurrency,
          hasReceipt: expense.receiptPath !== null,
          splits: expense.splits.map((s) => ({
            participantId: s.participantId,
            shareAmountBaseCurrency: s.shareAmountBaseCurrency,
          })),
        }}
      />
    </main>
  );
}
