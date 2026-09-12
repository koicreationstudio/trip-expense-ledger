import Link from 'next/link';
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

  // fix(2026-09-12 死路走查)：邀请链接通常是外部打开的（聊天记录/消息转发），进来
  // 之前很可能没浏览过这个站，不管链接有效还是失效，都该给一条明确能走的路，不能
  // 只靠物理返回键——失效那种尤其重要，返回键很多时候会直接退回聊天软件，走不进网站。
  if (result.status !== 'ok') {
    return (
      <main className="flex flex-col gap-4">
        <h1 className="text-base font-semibold text-ink">邀请链接</h1>
        <p className="text-[10px] text-muted">{STATUS_MESSAGE[result.status]}</p>
        <Link href="/" className="tap-link self-start text-[10px] text-muted hover:text-ink">
          ← 去首页看看
        </Link>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-6">
      <Link href="/" className="tap-link self-start text-[10px] text-muted hover:text-ink">
        ← 返回首页
      </Link>
      <div>
        <h1 className="text-base font-semibold text-ink">加入「{result.view.tripName}」</h1>
        <p className="mt-1 text-[10px] text-muted">选一下你是名单里的哪一位，认领后就能开始记账了。</p>
      </div>
      <ClaimForm code={params.code} tripId={result.view.tripId} unclaimedParticipants={result.view.unclaimedParticipants} />
    </main>
  );
}
