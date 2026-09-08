import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { participants, trips } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { toParticipantSummaryDto, toTripDto } from '@/lib/http/dto';

interface Context {
  params: { tripId: string };
}

export const GET = withSession<Context>(async (_request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const trip = await db.query.trips.findFirst({ where: eq(trips.id, params.tripId) });
  if (!trip) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const tripParticipants = await db.select().from(participants).where(eq(participants.tripId, params.tripId));

  return NextResponse.json({
    trip: toTripDto(trip),
    participants: tripParticipants.map(toParticipantSummaryDto),
  });
});
