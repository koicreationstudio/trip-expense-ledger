import { desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import { expenses, participants, trips } from '@/lib/db/schema';
import { getCurrentIdentity } from '@/lib/auth/current-session';
import { loadSettlementInput } from '@/lib/db/settlement-query';
import { computeNetBalances } from '@/lib/domain/settlement';
import { formatMoney } from '@/lib/money';
import { Avatar } from '@/components/avatar';
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

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{trip.name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          本位币 {trip.baseCurrency} · {STATUS_LABEL[trip.status] ?? trip.status}
        </p>
      </div>

      <section className="flex flex-col gap-3 rounded-lg bg-slate-900 p-5 text-white">
        <span className="text-xs uppercase tracking-wide text-slate-400">我的净额</span>
        <span
          className={`text-5xl font-semibold tabular-nums tracking-tight sm:text-6xl ${
            myNet >= 0 ? 'text-emerald-400' : 'text-red-400'
          }`}
        >
          {myNet >= 0 ? '+' : '-'}
          {formatMoney(Math.abs(myNet), trip.baseCurrency)}
        </span>
        <span className="text-sm text-slate-400">
          {myNet >= 0 ? '该收回' : '该付出'} · {unsettledCount} 笔消费
        </span>
        <Link href={`/trips/${trip.id}/settlement`} className="tap-link mt-1 text-sm text-slate-300">
          查看结算明细 →
        </Link>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-700">参与者</h2>
        <ul className="flex flex-col gap-1 rounded-md border border-slate-200 bg-white p-3">
          {tripParticipants.map((p) => {
            const net = netBalances.get(p.id) ?? 0;
            const isMe = p.id === identity.participantId;
            return (
              <li key={p.id} className="flex items-center gap-3 py-1">
                <Avatar name={p.displayName} />
                <div className="flex flex-1 flex-col">
                  <span className="text-base">
                    {p.displayName}
                    {p.isOwner && <span className="ml-2 text-xs text-slate-500">创建者</span>}
                  </span>
                  <span className="text-xs text-slate-400">{p.claimedAt ? '已认领' : '邀请待认领'}</span>
                </div>
                {isMe ? (
                  <span className="text-sm text-slate-400">我自己</span>
                ) : (
                  <span
                    className={`tabular-nums text-base ${net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
                  >
                    {net >= 0 ? '该收' : '该付'} {formatMoney(Math.abs(net), trip.baseCurrency)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-700">活动流</h2>
        <ExpenseList
          tripId={trip.id}
          myParticipantId={identity.participantId}
          expenses={tripExpenses.map((e) => ({
            id: e.id,
            category: e.category,
            amount: e.amount,
            currency: e.currency,
            expenseDate: e.expenseDate.toISOString(),
            hasReceipt: e.receiptPath !== null,
            payerName: nameById.get(e.payerParticipantId) ?? '未知',
            enteredByParticipantId: e.enteredByParticipantId,
          }))}
        />
      </section>
    </main>
  );
}
