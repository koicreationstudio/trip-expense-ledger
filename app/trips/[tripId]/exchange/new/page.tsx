import { and, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import { wallets } from '@/lib/db/schema';
import { getCurrentIdentity } from '@/lib/auth/current-session';
import { ExchangeForm } from '../exchange-form';

export default async function NewExchangePage({ params }: { params: { tripId: string } }) {
  const identity = await getCurrentIdentity();
  if (!identity || identity.tripId !== params.tripId) {
    redirect('/');
  }

  const db = await getDb();
  const myWallets = await db
    .select()
    .from(wallets)
    .where(and(eq(wallets.tripId, params.tripId), eq(wallets.participantId, identity.participantId)))
    .orderBy(wallets.createdAt);

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-base font-semibold text-ink">取款 / 换汇</h1>
      <ExchangeForm
        tripId={params.tripId}
        wallets={myWallets.map((w) => ({ id: w.id, label: w.label, currency: w.currency, emoji: w.emoji }))}
      />
    </main>
  );
}
