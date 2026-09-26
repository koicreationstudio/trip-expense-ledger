import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb, type Db } from '@/lib/db/client';
import { walletBalanceHistory, wallets } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { toWalletBalanceHistoryDto } from '@/lib/http/dto';

interface Context {
  params: { tripId: string; walletId: string };
}

async function loadOwn(db: Db, id: string, tripId: string, participantId: string) {
  return db.query.wallets.findFirst({
    where: and(eq(wallets.id, id), eq(wallets.tripId, tripId), eq(wallets.participantId, participantId)),
  });
}

/**
 * 「设置当前余额」的只读历史轨迹（2026-09-26 新增）——只追加、不改写，这里只是
 * 单纯按时间倒序读出来给钱包详情页展示。不接受任何「恢复这版」/「带回表单预填」
 * 相关的动作，那两个交互 Remy 还没拍板设计稿，这轮只做只读列表。
 */
export const GET = withSession<Context>(async (_request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const existing = await loadOwn(db, params.walletId, params.tripId, identity.participantId);
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const rows = await db
    .select()
    .from(walletBalanceHistory)
    .where(eq(walletBalanceHistory.walletId, params.walletId))
    .orderBy(desc(walletBalanceHistory.changedAt));

  return NextResponse.json({ history: rows.map(toWalletBalanceHistoryDto) });
});
