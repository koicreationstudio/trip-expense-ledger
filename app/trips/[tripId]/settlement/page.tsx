import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db/client';
import { participants, trips } from '@/lib/db/schema';
import { getCurrentIdentity } from '@/lib/auth/current-session';
import { loadSettlementInput } from '@/lib/db/settlement-query';
import { computeNetBalances, computeSettlement } from '@/lib/domain/settlement';
import { formatMoney } from '@/lib/money';
import { MarkSettledButton } from './mark-settled-button';

export default async function SettlementPage({ params }: { params: { tripId: string } }) {
  const identity = await getCurrentIdentity();
  if (!identity || identity.tripId !== params.tripId) {
    redirect('/');
  }

  const trip = await db.query.trips.findFirst({ where: eq(trips.id, params.tripId) });
  if (!trip) {
    redirect('/');
  }

  const tripParticipants = await db.select().from(participants).where(eq(participants.tripId, params.tripId));
  const nameById = new Map(tripParticipants.map((p) => [p.id, p.displayName]));

  const settlementInput = await loadSettlementInput(db, params.tripId);
  const netBalances = computeNetBalances(settlementInput);
  const transfers = computeSettlement(settlementInput);

  return (
    <main className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">结算</h1>

      {trip.status === 'settled' ? (
        <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">
          这个行程已标记结算，数字已冻结。
        </p>
      ) : (
        identity.isOwner && <MarkSettledButton tripId={trip.id} />
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-700">每人净值</h2>
        <ul className="flex flex-col gap-1 rounded-md border border-slate-200 bg-white p-3">
          {[...netBalances.entries()].map(([participantId, amount]) => (
            <li key={participantId} className="flex items-center justify-between text-sm">
              <span>{nameById.get(participantId) ?? participantId}</span>
              <span className={amount >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                {amount >= 0 ? '该收' : '该付'} {formatMoney(Math.abs(amount), trip.baseCurrency)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-700">转账清单</h2>
        {transfers.length === 0 ? (
          <p className="text-sm text-slate-500">目前不需要任何转账。</p>
        ) : (
          <ul className="flex flex-col gap-1 rounded-md border border-slate-200 bg-white p-3">
            {transfers.map((t, index) => (
              <li key={index} className="text-sm">
                {nameById.get(t.fromParticipantId) ?? t.fromParticipantId} → {nameById.get(t.toParticipantId) ?? t.toParticipantId}
                ：{formatMoney(t.amountBaseCurrency, trip.baseCurrency)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
