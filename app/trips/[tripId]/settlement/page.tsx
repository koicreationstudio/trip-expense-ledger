import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import { participants, trips } from '@/lib/db/schema';
import { getCurrentIdentity } from '@/lib/auth/current-session';
import { loadSettlementInput } from '@/lib/db/settlement-query';
import { computeNetBalances, computeSettlement } from '@/lib/domain/settlement';
import { formatMoney } from '@/lib/money';
import { Avatar } from '@/components/avatar';
import { MarkSettledButton } from './mark-settled-button';

export default async function SettlementPage({ params }: { params: { tripId: string } }) {
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

  const settlementInput = await loadSettlementInput(db, params.tripId);
  const netBalances = computeNetBalances(settlementInput);
  const transfers = computeSettlement(settlementInput);

  return (
    <main className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">结算</h1>

      {trip.status === 'settled' ? (
        <p className="rounded-xl bg-sand px-3 py-2 text-base text-slate-600">
          这个行程已标记结算，数字已冻结。
        </p>
      ) : (
        identity.isOwner && <MarkSettledButton tripId={trip.id} />
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-700">每人净值</h2>
        <ul className="flex flex-col gap-1 rounded-xl border border-sand bg-paper p-3">
          {[...netBalances.entries()].map(([participantId, amount]) => {
            const name = nameById.get(participantId) ?? participantId;
            return (
              <li key={participantId} className="flex items-center gap-3 py-1">
                <Avatar name={name} />
                <span className="flex-1 text-base">{name}</span>
                <span className={`font-serif tabular-nums text-base ${amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {amount >= 0 ? '该收' : '该付'} {formatMoney(Math.abs(amount), trip.baseCurrency)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-700">转账清单</h2>
        {transfers.length === 0 ? (
          <p className="text-sm text-muted">目前不需要任何转账。</p>
        ) : (
          <ul className="flex flex-col gap-2 rounded-xl border border-sand bg-paper p-3">
            {transfers.map((t, index) => {
              const fromName = nameById.get(t.fromParticipantId) ?? t.fromParticipantId;
              const toName = nameById.get(t.toParticipantId) ?? t.toParticipantId;
              return (
                <li key={index} className="flex flex-wrap items-center justify-between gap-2 text-base">
                  <span className="flex flex-wrap items-center gap-2">
                    <Avatar name={fromName} size={28} />
                    <span>{fromName}</span>
                    <span className="text-muted" aria-hidden="true">
                      →
                    </span>
                    <Avatar name={toName} size={28} />
                    <span>{toName}</span>
                  </span>
                  <span className="font-serif tabular-nums">{formatMoney(t.amountBaseCurrency, trip.baseCurrency)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
