import { and, eq, isNotNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { expenses, participants, trips } from '@/lib/db/schema';
import { assertSameTrip, withSession, withTripOwner } from '@/lib/auth/require-session';
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
 * 删行程是破坏性动作，只有 owner 能做，非 owner/非本行程一律 404
 * （withTripOwner 统一处理，跟 invites/settlement 等其它 admin 操作同一套规矩）。
 *
 * schema.ts 里所有指向 trips.id 的外键都配了 onDelete: 'cascade'（participants→
 * sessions→…、expenses→expenseSplits、wallets→exchangeRecords、
 * settlementSnapshots 等），删 trip 本体这一条语句会让 D1 自己顺着外键链清空
 * 全部关联行，不需要在这里手写逐表删除。
 *
 * 唯一不在这条级联链里的是收据原图：receipt_path 只是存在 expense 表里的一个
 * R2 object key 字符串，R2 不吃 SQL 外键，级联删 DB 行不会顺手删掉 R2 里的文件，
 * 不然 trip 记录没了但收据图片永远留在桶里没人清。所以删 DB 记录之前，先把这趟
 * 行程下所有还挂着收据的消费查出来，挨个丢 R2 delete（跟单笔消费 DELETE 那边
 * 处理 receiptPath 的方式一致）。
 */
export const DELETE = withTripOwner<Context>(async (_request, { params }) => {
  const db = await getDb();
  const existing = await db.query.trips.findFirst({ where: eq(trips.id, params.tripId) });
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const expensesWithReceipt = await db
    .select({ receiptPath: expenses.receiptPath })
    .from(expenses)
    .where(and(eq(expenses.tripId, params.tripId), isNotNull(expenses.receiptPath)));
  await Promise.all(expensesWithReceipt.map((e) => deleteReceipt(e.receiptPath!)));

  await db.delete(trips).where(eq(trips.id, params.tripId));

  return new NextResponse(null, { status: 204 });
});
