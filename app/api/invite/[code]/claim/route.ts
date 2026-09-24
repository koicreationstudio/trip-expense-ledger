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

/**
 * 原生表单提交（2026-09-24 第六十四轮，跟首页行程卡片同一类"水合前点了等于白点"的横扫）：
 * 同行人冷启动打开邀请链接，JS 还没下载完就点「认领这个身份」，以前只是整页刷新一下、
 * 什么都没认领。现在 claim-form 外层是真正的 `<form method="post">` 指向这里，表单分支
 * 跟 JSON 分支走完全同一套校验，只是回应改成 303：成功直接进行程页，失败回邀请页
 * （页面会重新列出还剩谁没被认领）。
 */
function isFormSubmission(request: NextRequest): boolean {
  const type = request.headers.get('content-type') ?? '';
  return type.startsWith('application/x-www-form-urlencoded') || type.startsWith('multipart/form-data');
}

export async function POST(request: NextRequest, { params }: Context) {
  const db = await getDb();
  const fromForm = isFormSubmission(request);
  const backToInvite = () =>
    NextResponse.redirect(new URL(`/invite/${encodeURIComponent(params.code)}`, request.url), 303);

  let participantId: string;
  if (fromForm) {
    const form = await request.formData().catch(() => null);
    const parsed = claimParticipantSchema.safeParse({ participantId: form?.get('participantId') });
    if (!parsed.success) return backToInvite();
    participantId = parsed.data.participantId;
  } else {
    const parsed = await parseJsonBody(request, claimParticipantSchema);
    if ('error' in parsed) return parsed.error;
    participantId = parsed.data.participantId;
  }

  const invite = await lookupInvite(db, params.code);
  if (invite.status !== 'ok') {
    if (fromForm) return backToInvite();
    return NextResponse.json({ status: invite.status }, { status: 404 });
  }

  // 只能认领这个邀请码当前展示的未认领名单里的人，不能拿这个码去认领别的 participantId。
  const isOfferedName = invite.view.unclaimedParticipants.some((p) => p.id === participantId);
  if (!isOfferedName) {
    if (fromForm) return backToInvite();
    return NextResponse.json({ error: 'invalid_participant' }, { status: 400 });
  }

  const claim = await claimParticipant(db, participantId);
  if (claim.status !== 'ok') {
    if (fromForm) return backToInvite();
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

  const response = fromForm
    ? NextResponse.redirect(new URL(`/trips/${invite.view.tripId}`, request.url), 303)
    : NextResponse.json({ ok: true, participantId: claim.participantId });
  return attachSessionCookie(response, token);
}
