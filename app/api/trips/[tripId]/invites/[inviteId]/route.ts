import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { invites } from '@/lib/db/schema';
import { withTripOwner } from '@/lib/auth/require-session';

interface Context {
  params: { tripId: string; inviteId: string };
}

export const DELETE = withTripOwner<Context>(async (_request, { params }) => {
  const existing = await db.query.invites.findFirst({
    where: and(eq(invites.id, params.inviteId), eq(invites.tripId, params.tripId)),
  });
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await db.update(invites).set({ revokedAt: new Date() }).where(eq(invites.id, params.inviteId));

  return new NextResponse(null, { status: 204 });
});
