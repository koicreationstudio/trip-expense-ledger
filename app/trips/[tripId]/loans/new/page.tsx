import { and, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import { participants, trips, wallets } from '@/lib/db/schema';
import { getCurrentIdentity } from '@/lib/auth/current-session';
import { LoanForm } from '../loan-form';

export default async function NewLoanPage({ params }: { params: { tripId: string } }) {
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

  // 「从哪个钱包出」只列我自己名下的钱包——跟 exchange-form.tsx 的钱包私有规矩
  // 一致，见 loan-form.tsx 顶部注释。
  const myWallets = await db
    .select()
    .from(wallets)
    .where(and(eq(wallets.tripId, params.tripId), eq(wallets.participantId, identity.participantId)))
    .orderBy(wallets.createdAt);

  return (
    <main className="flex flex-col gap-3.5">
      <h1 className="text-[15px] font-bold text-ink">借钱给同行人</h1>
      <LoanForm
        tripId={trip.id}
        myParticipantId={identity.participantId}
        baseCurrency={trip.baseCurrency}
        participants={tripParticipants.map((p) => ({ id: p.id, displayName: p.displayName }))}
        wallets={myWallets.map((w) => ({ id: w.id, label: w.label, currency: w.currency, emoji: w.emoji }))}
      />
    </main>
  );
}
