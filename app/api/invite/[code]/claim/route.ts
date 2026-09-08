import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { claimParticipant, lookupInvite } from '@/lib/auth/invite';
import { createSession } from '@/lib/auth/session';
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

  // 同行人认领不强制注册，这是保低摩擦协作的差异化卖点。这里不做"顺手关联账号"——
  // 那需要基于*这次认领刚建的 tel_session*、用户*事后主动*登录/注册时才触发
  // （见 app/api/account/link-current-trip/route.ts，被 login/signup 页面调用）。
  // 之前这里改成看 ambient 的 tel_user_session cookie 就直接绑定，等于"浏览器随便
  // 带着任何账号的登录态"都会被静默、永久关联到刚认领的这个 participant——2026-09-08
  // ui-auditor 走查实测复现为数据泄露（认领者看到了 cookie 所属账号名下所有行程的
  // 支付方式），已移除，改回只走 link-current-trip 这条需要用户显式登录/注册动作的路径。
  const token = await createSession(db, claim.participantId, request.headers.get('user-agent'));

  const response = NextResponse.json({ ok: true, participantId: claim.participantId });
  return attachSessionCookie(response, token);
}
