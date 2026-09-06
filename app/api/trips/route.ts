import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { participants, trips } from '@/lib/db/schema';
import { createSession } from '@/lib/auth/session';
import { attachSessionCookie } from '@/lib/http/session-cookie';
import { toParticipantSummaryDto, toTripDto } from '@/lib/http/dto';
import { parseJsonBody } from '@/lib/http/validate';
import { createTripSchema } from '@/lib/validation/schemas';

/**
 * 建行程：创建者自己算第一个 participant（isOwner=true，直接认领），
 * 后面追加的同行人名字都是未认领占位，等邀请链接发出去后各自认领。
 * 三张表的写入放进一个同步事务，避免中途失败留下没有 owner 的孤儿 trip。
 */
export async function POST(request: NextRequest) {
  const parsed = await parseJsonBody(request, createTripSchema);
  if ('error' in parsed) return parsed.error;
  const { name, baseCurrency, ownerDisplayName, participantNames } = parsed.data;

  const tripId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();

  db.transaction((tx) => {
    tx.insert(trips).values({ id: tripId, name, baseCurrency }).run();
    tx.insert(participants)
      .values({ id: ownerId, tripId, displayName: ownerDisplayName, isOwner: true, claimedAt: new Date() })
      .run();
    for (const displayName of participantNames) {
      tx.insert(participants).values({ tripId, displayName }).run();
    }
    tx.update(trips).set({ ownerParticipantId: ownerId }).where(eq(trips.id, tripId)).run();
  });

  const token = await createSession(db, ownerId, request.headers.get('user-agent'));

  const trip = await db.query.trips.findFirst({ where: eq(trips.id, tripId) });
  const tripParticipants = await db.select().from(participants).where(eq(participants.tripId, tripId));

  const response = NextResponse.json(
    {
      trip: toTripDto(trip!),
      participants: tripParticipants.map(toParticipantSummaryDto),
    },
    { status: 201 }
  );

  return attachSessionCookie(response, token);
}
