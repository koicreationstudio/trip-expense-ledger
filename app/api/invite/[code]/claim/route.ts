import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { participants } from '@/lib/db/schema';
import { claimParticipant, lookupInvite } from '@/lib/auth/invite';
import { createSession } from '@/lib/auth/session';
import { resolveUser, USER_SESSION_COOKIE_NAME } from '@/lib/auth/user-session';
import { attachSessionCookie } from '@/lib/http/session-cookie';
import { parseJsonBody } from '@/lib/http/validate';
import { claimParticipantSchema } from '@/lib/validation/schemas';

interface Context {
  params: { code: string };
}

export async function POST(request: NextRequest, { params }: Context) {
  const db = await getDb();
  const parsed = await parseJsonBody(request, claimParticipantSchema);
  if ('error' in parsed) return parsed.error;

  const invite = await lookupInvite(db, params.code);
  if (invite.status !== 'ok') {
    return NextResponse.json({ status: invite.status }, { status: 404 });
  }

  // 只能认领这个邀请码当前展示的未认领名单里的人，不能拿这个码去认领别的 participantId。
  const isOfferedName = invite.view.unclaimedParticipants.some((p) => p.id === parsed.data.participantId);
  if (!isOfferedName) {
    return NextResponse.json({ error: 'invalid_participant' }, { status: 400 });
  }

  const claim = await claimParticipant(db, parsed.data.participantId);
  if (claim.status !== 'ok') {
    return NextResponse.json({ error: claim.status }, { status: 409 });
  }

  // 同行人认领不强制注册，这是保低摩擦协作的差异化卖点。但如果当前浏览器
  // 恰好也带着有效的 tel_user_session（自己顺手登录/注册过、或者是老用户），
  // 就顺手把这个 participant 关联上账号，方便以后在别的设备找到这个行程。
  const userToken = request.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
  const user = await resolveUser(db, userToken);
  if (user) {
    await db.update(participants).set({ userId: user.userId }).where(eq(participants.id, claim.participantId));
  }

  const token = await createSession(db, claim.participantId, request.headers.get('user-agent'));

  const response = NextResponse.json({ ok: true, participantId: claim.participantId });
  return attachSessionCookie(response, token);
}
