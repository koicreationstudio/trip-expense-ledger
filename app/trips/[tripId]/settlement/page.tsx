import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import { participants, trips } from '@/lib/db/schema';
import { getCurrentIdentity } from '@/lib/auth/current-session';
import {
  loadConfirmedTransferPairs,
  loadSettlementDetail,
  loadSettlementInput,
} from '@/lib/db/settlement-query';
import { computeNetBalances, computeSettlement } from '@/lib/domain/settlement';
import { SettlementBody } from './settlement-body';

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
  const [detailByParticipant, confirmedPairs] = await Promise.all([
    loadSettlementDetail(db, params.tripId),
    loadConfirmedTransferPairs(db, params.tripId),
  ]);

  const netEntries = [...netBalances.entries()].map(([participantId, amount]) => ({
    participantId,
    name: nameById.get(participantId) ?? participantId,
    amount,
    detail: detailByParticipant.get(participantId) ?? [],
  }));

  const transferEntries = transfers.map((t) => ({
    fromParticipantId: t.fromParticipantId,
    toParticipantId: t.toParticipantId,
    fromName: nameById.get(t.fromParticipantId) ?? t.fromParticipantId,
    toName: nameById.get(t.toParticipantId) ?? t.toParticipantId,
    amountBaseCurrency: t.amountBaseCurrency,
    confirmed: confirmedPairs.has(`${t.fromParticipantId}:${t.toParticipantId}`),
  }));

  return (
    <main className="flex flex-col gap-8">
      {/* fix(2026-09-15)：16px(text-base) 改成 15px，对齐"我的行程"/"我的账号"/
          "支付方式"三处已经统一的标题规格。 */}
      <h1 className="text-[15px] font-semibold text-ink">结算</h1>

      {trip.status === 'settled' && (
        <div className="flex w-fit items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-ok-bg px-[9px] py-[3px] text-[9.5px] font-medium text-ok">
            已结算
          </span>
          <span className="text-[11px] text-muted">数字已冻结</span>
        </div>
      )}

      <SettlementBody
        tripId={trip.id}
        baseCurrency={trip.baseCurrency}
        netEntries={netEntries}
        transfers={transferEntries}
        myParticipantId={identity.participantId}
        isOwner={identity.isOwner}
        alreadySettled={trip.status === 'settled'}
      />
    </main>
  );
}
