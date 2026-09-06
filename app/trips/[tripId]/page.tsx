import { and, desc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db/client';
import { expenses, participants, trips } from '@/lib/db/schema';
import { getCurrentIdentity } from '@/lib/auth/current-session';
import { ExpenseList } from './expense-list';

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

  const trip = await db.query.trips.findFirst({ where: eq(trips.id, params.tripId) });
  if (!trip) {
    redirect('/');
  }

  const tripParticipants = await db.select().from(participants).where(eq(participants.tripId, params.tripId));

  const myExpenses = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.tripId, params.tripId), eq(expenses.enteredByParticipantId, identity.participantId)))
    .orderBy(desc(expenses.expenseDate));

  return (
    <main className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">{trip.name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          本位币 {trip.baseCurrency} · {STATUS_LABEL[trip.status] ?? trip.status}
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-700">参与者</h2>
        <ul className="flex flex-col gap-1 rounded-md border border-slate-200 bg-white p-3">
          {tripParticipants.map((p) => (
            <li key={p.id} className="flex items-center justify-between text-sm">
              <span>
                {p.displayName}
                {p.isOwner && <span className="ml-2 text-xs text-slate-400">创建者</span>}
              </span>
              <span className={p.claimedAt ? 'text-emerald-600' : 'text-slate-400'}>
                {p.claimedAt ? '已认领' : '未认领'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-700">我的消费记录</h2>
        <ExpenseList
          tripId={trip.id}
          expenses={myExpenses.map((e) => ({
            id: e.id,
            category: e.category,
            amount: e.amount,
            currency: e.currency,
            expenseDate: e.expenseDate.toISOString(),
            hasReceipt: e.receiptPath !== null,
          }))}
        />
      </section>
    </main>
  );
}
