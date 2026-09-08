import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
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
  const db = await getDb();
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

  // D1 的 remote binding 不支持交互式多语句事务，官方推荐用 batch() 做原子
  // 多语句写入；这几条语句互不依赖对方的执行结果，符合 batch 的用法。
  // 数组长度随 participantNames 变化，TS 的 batch() 签名要求一个至少 1 项的
  // 元组类型来做逐项类型推断，这里的动态数组结构上退化成普通数组，做一次断言
  // （运行时永远至少有 3 项：建 trip / 建 owner / 回填 ownerParticipantId）。
  const statements = [
    db.insert(trips).values({ id: tripId, name, baseCurrency }),
    db.insert(participants).values({
      id: ownerId,
      tripId,
      displayName: ownerDisplayName,
      isOwner: true,
      claimedAt: new Date(),
      userId: user.userId,
    }),
    ...participantNames.map((displayName) => db.insert(participants).values({ tripId, displayName })),
    db.update(trips).set({ ownerParticipantId: ownerId }).where(eq(trips.id, tripId)),
  ];
  await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);

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
