import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { participants, trips } from '@/lib/db/schema';
import { createSession } from '@/lib/auth/session';
import { resolveUser, USER_SESSION_COOKIE_NAME } from '@/lib/auth/user-session';
import { attachSessionCookie } from '@/lib/http/session-cookie';
import { toParticipantSummaryDto, toTripDto } from '@/lib/http/dto';
import { parseJsonBody } from '@/lib/http/validate';
import { createTripSchema } from '@/lib/validation/schemas';

/**
 * 建行程：创建者自己算第一个 participant（isOwner=true，直接认领），
 * 后面追加的同行人名字都是未认领占位，等邀请链接发出去后各自认领。
 * 三张表的写入放进一个同步事务，避免中途失败留下没有 owner 的孤儿 trip。
 *
 * 创建者必须有账号（app/trips/new 页面已经强制登录跳转），这里读 tel_user_session
 * 把 userId 顺手写进 owner 的 participant 行，否则首页"我的行程"列表找不到这个 trip。
 * 这是唯一一处碰 Layer 1 权限写入路径的地方，只加一列不改任何鉴权判断。
 */
export async function POST(request: NextRequest) {
  const userToken = request.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
  const user = await resolveUser(db, userToken);
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = await parseJsonBody(request, createTripSchema);
  if ('error' in parsed) return parsed.error;
  const { name, baseCurrency, ownerDisplayName, participantNames } = parsed.data;

  const tripId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();

  db.transaction((tx) => {
    tx.insert(trips).values({ id: tripId, name, baseCurrency }).run();
    tx.insert(participants)
      .values({
        id: ownerId,
        tripId,
        displayName: ownerDisplayName,
        isOwner: true,
        claimedAt: new Date(),
        userId: user.userId,
      })
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
