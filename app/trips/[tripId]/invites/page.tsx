import { redirect } from 'next/navigation';
import { getCurrentIdentity } from '@/lib/auth/current-session';
import { InvitesManager } from './invites-manager';

export default async function InvitesPage({ params }: { params: { tripId: string } }) {
  const identity = await getCurrentIdentity();
  if (!identity || identity.tripId !== params.tripId) {
    redirect('/');
  }
  if (!identity.isOwner) {
    redirect(`/trips/${params.tripId}`);
  }

  return (
    <main className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">邀请管理</h1>
      <InvitesManager tripId={params.tripId} />
    </main>
  );
}
