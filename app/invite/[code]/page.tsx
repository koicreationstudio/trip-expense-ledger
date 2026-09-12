import { getDb } from '@/lib/db/client';
import { lookupInvite } from '@/lib/auth/invite';
import { ClaimForm } from './claim-form';

const STATUS_MESSAGE: Record<string, string> = {
  not_found: '这个邀请链接已失效。',
  expired: '这个邀请链接已失效。',
  revoked: '这个邀请链接已失效。',
  full: '这个行程的名额已满，所有人都已经认领了。',
};

export default async function InviteClaimPage({ params }: { params: { code: string } }) {
  const db = await getDb();
  const result = await lookupInvite(db, params.code);

  if (result.status !== 'ok') {
    return (
      <main className="flex flex-col gap-4">
        <h1 className="text-base font-semibold text-ink">邀请链接</h1>
        <p className="text-[10px] text-muted">{STATUS_MESSAGE[result.status]}</p>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="text-base font-semibold text-ink">加入「{result.view.tripName}」</h1>
        <p className="mt-1 text-[10px] text-muted">选一下你是名单里的哪一位，认领后就能开始记账了。</p>
      </div>
      <ClaimForm code={params.code} tripId={result.view.tripId} unclaimedParticipants={result.view.unclaimedParticipants} />
    </main>
  );
}
