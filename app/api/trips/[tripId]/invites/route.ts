import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { invites } from '@/lib/db/schema';
import { withTripOwner } from '@/lib/auth/require-session';
import { generateInviteCode } from '@/lib/auth/invite';
import { parseJsonBody } from '@/lib/http/validate';
import { createInviteSchema } from '@/lib/validation/schemas';

interface Context {
  params: { tripId: string };
}

/** 邀请管理是 admin 操作，统一走 withTripOwner，非 owner 一律 404。 */
export const POST = withTripOwner<Context>(async (request, { params }, identity) => {
  const parsed = await parseJsonBody(request, createInviteSchema);
  if ('error' in parsed) return parsed.error;

  const id = crypto.randomUUID();
  const code = generateInviteCode();
  const expiresAt = parsed.data.expiresInDays
    ? new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  await db.insert(invites).values({
    id,
    tripId: params.tripId,
    code,
    createdByParticipantId: identity.participantId,
    expiresAt,
  });

  return NextResponse.json({ id, code, expiresAt: expiresAt?.toISOString() ?? null }, { status: 201 });
});

export const GET = withTripOwner<Context>(async (_request, { params }) => {
  const rows = await db.select().from(invites).where(eq(invites.tripId, params.tripId));

  return NextResponse.json({
    invites: rows.map((r) => ({
      id: r.id,
      code: r.code,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt?.toISOString() ?? null,
      revokedAt: r.revokedAt?.toISOString() ?? null,
    })),
  });
});
