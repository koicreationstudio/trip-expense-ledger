import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { claimParticipant, lookupInvite } from '@/lib/auth/invite';
import { createSession } from '@/lib/auth/session';
import { attachSessionCookie } from '@/lib/http/session-cookie';
import { parseJsonBody } from '@/lib/http/validate';
import { claimParticipantSchema } from '@/lib/validation/schemas';

interface Context {
  params: { code: string };
}

export async function POST(request: NextRequest, { params }: Context) {
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

  const token = await createSession(db, claim.participantId, request.headers.get('user-agent'));

  const response = NextResponse.json({ ok: true, participantId: claim.participantId });
  return attachSessionCookie(response, token);
}
