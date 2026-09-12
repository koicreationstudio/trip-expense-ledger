import { and, eq, isNotNull } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { expenses, participants, trips } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { resolveIdentity, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { resolveUser, USER_SESSION_COOKIE_NAME } from '@/lib/auth/user-session';
import { toParticipantSummaryDto, toTripDto } from '@/lib/http/dto';
import { deleteReceipt } from '@/lib/storage/receipts';

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

/**
 * 删行程是破坏性动作，只有 owner 能做。鉴权拆两条腿，不直接套 withTripOwner：
 *
 * ① tel_session（Layer 1，当前浏览器正待着的那趟行程）—— 删的正好是这趟 trip
 *    本身时，跟以前一样判 identity.tripId === params.tripId && identity.isOwner。
 * ② tel_user_session（Layer 2，账号）—— 行程切换器面板列表里"账号名下其它
 *    行程，不是当前正在看的这趟，但自己在那趟里也是 owner"也能直接删掉，这类
 *    请求的 tel_session 还停在原来那趟 trip 上，①判不出来；改成跟 switch-trip
 *    同一个模式：查这个账号在目标 tripId 下的 participant 行是不是 owner。
 *
 * 两条腿都没查到任何有效身份 → 401（没登录）；查到了身份但两条都通不过 owner
 * 判定 → 404（越权，不泄露"这个 trip 是否存在"），跟其它 admin 操作同一套原则。
 *
 * schema.ts 里所有指向 trips.id 的外键都配了 onDelete: 'cascade'（participants→
 * sessions→…、expenses→expenseSplits、wallets→exchangeRecords、
 * settlementSnapshots 等），删 trip 本体这一条语句会让 D1 自己顺着外键链清空
 * 全部关联行，不需要在这里手写逐表删除（route.test.ts 里真删了一趟带 expense/
 * wallet/participant 的行程再查库断言全部清零，不是只信 schema.ts 写着就当真）。
 *
 * 唯一不在这条级联链里的是收据原图：receipt_path 只是存在 expense 表里的一个
 * R2 object key 字符串，R2 不吃 SQL 外键，级联删 DB 行不会顺手删掉 R2 里的文件，
 * 不然 trip 记录没了但收据图片永远留在桶里没人清。所以删 DB 记录之前，先把这趟
 * 行程下所有还挂着收据的消费查出来，挨个丢 R2 delete（跟单笔消费 DELETE 那边
 * 处理 receiptPath 的方式一致）。
 */
export async function DELETE(request: NextRequest, { params }: Context) {
  const db = await getDb();

  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const userToken = request.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
  const [identity, user] = await Promise.all([resolveIdentity(db, sessionToken), resolveUser(db, userToken)]);

  if (!identity && !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let authorized = Boolean(identity && identity.tripId === params.tripId && identity.isOwner);
  if (!authorized && user) {
    const ownedParticipant = await db.query.participants.findFirst({
      where: and(
        eq(participants.tripId, params.tripId),
        eq(participants.userId, user.userId),
        eq(participants.isOwner, true)
      ),
    });
    authorized = Boolean(ownedParticipant);
  }
  if (!authorized) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const existing = await db.query.trips.findFirst({ where: eq(trips.id, params.tripId) });
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const expensesWithReceipt = await db
    .select({ receiptPath: expenses.receiptPath })
    .from(expenses)
    .where(and(eq(expenses.tripId, params.tripId), isNotNull(expenses.receiptPath)));
  await Promise.all(expensesWithReceipt.map((e) => deleteReceipt(e.receiptPath!)));

  await db.delete(trips).where(eq(trips.id, params.tripId));

  return new NextResponse(null, { status: 204 });
}
