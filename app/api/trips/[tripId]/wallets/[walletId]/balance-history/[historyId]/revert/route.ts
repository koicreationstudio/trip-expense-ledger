import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb, type Db } from '@/lib/db/client';
import { wallets, walletBalanceHistory } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { toWalletBalanceHistoryDto, toWalletDto } from '@/lib/http/dto';
import { computeWalletDisplayBalance, withDisplayBalance } from '@/lib/domain/wallet-balance';
import { computeHistoryEditFields, isCurrentBalanceHistoryEntry } from '@/lib/domain/wallet-balance-history';

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
 * 「还原成原始值」（round72 第三批新增）：不需要 body——目标值就是这条记录自己
 * 存着的 `originalAmount`/`originalEffectiveDate`，不用调用方再传一遍。这条
 * 记录从没被编辑过（`originalAmount` 是 null）时没有原始值可还原，返回 400
 * `nothing_to_revert`。
 *
 * 写库逻辑跟 `../route.ts` 的 PATCH 完全一样（`isCurrent` 分两种情况），唯一
 * 区别是目标值来自 `originalAmount`/`originalEffectiveDate` 而不是请求体，
 * 而且 `computeHistoryEditFields` 这次会把原始值字段清空成 null（还原之后
 * 这条记录不再带"已更正"标签）。
 */
export const POST = withSession<Context>(async (_request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const wallet = await loadOwnWallet(db, params.walletId, params.tripId, identity.participantId);
  if (!wallet) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const existingEntry = await loadOwnHistoryEntry(db, params.historyId, params.walletId);
  if (!existingEntry) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (existingEntry.originalAmount === null || existingEntry.originalEffectiveDate === null) {
    return NextResponse.json({ error: 'nothing_to_revert' }, { status: 400 });
  }

  const isCurrent = await isCurrentBalanceHistoryEntry(db, params.walletId, params.historyId);
  const editFields = computeHistoryEditFields(
    existingEntry,
    { amount: existingEntry.originalAmount, effectiveDate: existingEntry.originalEffectiveDate },
    true
  );

  if (!isCurrent) {
    await db
      .update(walletBalanceHistory)
      .set({
        amount: editFields.amount,
        effectiveDate: editFields.effectiveDate,
        originalAmount: editFields.originalAmount,
        originalEffectiveDate: editFields.originalEffectiveDate,
      })
      .where(eq(walletBalanceHistory.id, params.historyId));

    const updatedEntry = await loadOwnHistoryEntry(db, params.historyId, params.walletId);
    return NextResponse.json({ history: toWalletBalanceHistoryDto(updatedEntry!), isCurrent: false });
  }

  const displayBalanceBefore = await computeWalletDisplayBalance(db, wallet);

  await db
    .update(wallets)
    .set({ currentBalance: editFields.amount, balanceUpdatedAt: editFields.effectiveDate })
    .where(eq(wallets.id, params.walletId));

  const updatedWallet = await db.query.wallets.findFirst({ where: eq(wallets.id, params.walletId) });
  const displayBalanceAfter = await computeWalletDisplayBalance(db, updatedWallet!);

  await db
    .update(walletBalanceHistory)
    .set({
      amount: editFields.amount,
      effectiveDate: editFields.effectiveDate,
      originalAmount: editFields.originalAmount,
      originalEffectiveDate: editFields.originalEffectiveDate,
      displayBalanceAfter,
    })
    .where(eq(walletBalanceHistory.id, params.historyId));

  const updatedEntry = await loadOwnHistoryEntry(db, params.historyId, params.walletId);

  return NextResponse.json({
    wallet: toWalletDto(await withDisplayBalance(db, updatedWallet!)),
    history: toWalletBalanceHistoryDto(updatedEntry!),
    isCurrent: true,
    displayBalanceBefore,
    displayBalanceAfter,
  });
});
