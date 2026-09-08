import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { participants } from '@/lib/db/schema';
import { withTripOwner } from '@/lib/auth/require-session';
import { revokeAllSessions } from '@/lib/auth/session';

interface Context {
  params: { tripId: string; participantId: string };
}

/** 纠错用：认领错人/换手机号，owner 可以把某个占位重新变回未认领状态。 */
export const POST = withTripOwner<Context>(async (_request, { params }) => {
  const db = await getDb();
  const existing = await db.query.participants.findFirst({
    where: and(eq(participants.id, params.participantId), eq(participants.tripId, params.tripId)),
  });
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (existing.isOwner) {
    return NextResponse.json({ error: 'cannot_reset_owner' }, { status: 400 });
  }

  await revokeAllSessions(db, params.participantId);
  // 连 userId 一起清掉：不清的话，重置后换一个人认领这个占位，会在对方不知情的
  // 情况下继承前一个人账号名下的 payment_method（同一个 participant 行留着旧
  // userId，下一次身份解析照样按这个 userId 查）。
  await db
    .update(participants)
    .set({ claimedAt: null, userId: null })
    .where(eq(participants.id, params.participantId));

  return NextResponse.json({ ok: true });
});
