import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb, type Db } from '@/lib/db/client';
import { wallets, walletBalanceHistory } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { parseJsonBody } from '@/lib/http/validate';
import { previewBalanceHistoryEditSchema } from '@/lib/validation/schemas';
import { computeWalletDisplayBalance, withHypotheticalAnchor } from '@/lib/domain/wallet-balance';
import { isCurrentBalanceHistoryEntry } from '@/lib/domain/wallet-balance-history';

interface Context {
  params: { tripId: string; walletId: string; historyId: string };
}

async function loadOwnWallet(db: Db, id: string, tripId: string, participantId: string) {
  return db.query.wallets.findFirst({
    where: and(eq(wallets.id, id), eq(wallets.tripId, tripId), eq(wallets.participantId, participantId)),
  });
}

async function loadOwnHistoryEntry(db: Db, historyId: string, walletId: string) {
  return db.query.walletBalanceHistory.findFirst({
    where: and(eq(walletBalanceHistory.id, historyId), eq(walletBalanceHistory.walletId, walletId)),
  });
}

/**
 * 「编辑一条历史记录」防覆盖确认流程专用（round72 第三批新增）：不写库，纯算
 * "编辑之后会怎样"给确认页看。跟 `../../balance-preview/route.ts`（设置当前
 * 余额那个防覆盖预览端点）是表亲关系——同一套鉴权模式、同一个
 * `computeWalletDisplayBalance`/`withHypotheticalAnchor`，区别只在于这里先要
 * 判断"编辑的这条历史记录是不是当前生效"（`isCurrentBalanceHistoryEntry`）：
 *
 * - 是当前生效：编辑它会改变钱包现在显示的余额，返回 `displayBalanceBefore`/
 *   `displayBalanceAfter` 两个数字给确认页画"改前→改后"。
 * - 不是（已经被更新的记录覆盖的旧历史）：编辑它只改这条记录本身，钱包当前
 *   余额完全不受影响，直接返回 `isCurrent: false`，前端看到这个就知道该走
 *   "不影响当前余额"的说明文案分支，不用再多算什么。
 */
export const POST = withSession<Context>(async (request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const wallet = await loadOwnWallet(db, params.walletId, params.tripId, identity.participantId);
  if (!wallet) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const historyEntry = await loadOwnHistoryEntry(db, params.historyId, params.walletId);
  if (!historyEntry) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const parsed = await parseJsonBody(request, previewBalanceHistoryEditSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  const isCurrent = await isCurrentBalanceHistoryEntry(db, params.walletId, params.historyId);
  if (!isCurrent) {
    return NextResponse.json({ isCurrent: false });
  }

  const displayBalanceBefore = await computeWalletDisplayBalance(db, wallet);
  const hypothetical = withHypotheticalAnchor(wallet, body.newAmount, new Date(body.newEffectiveDate));
  const displayBalanceAfter = await computeWalletDisplayBalance(db, hypothetical);

  return NextResponse.json({ isCurrent: true, displayBalanceBefore, displayBalanceAfter });
});
