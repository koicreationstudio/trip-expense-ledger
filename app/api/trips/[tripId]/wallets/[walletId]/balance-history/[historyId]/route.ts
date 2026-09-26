import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb, type Db } from '@/lib/db/client';
import { wallets, walletBalanceHistory } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { toWalletBalanceHistoryDto, toWalletDto } from '@/lib/http/dto';
import { parseJsonBody } from '@/lib/http/validate';
import { updateBalanceHistorySchema } from '@/lib/validation/schemas';
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
 * 「直接编辑一条历史记录」（round72 第三批新增，取代 round70 那份"只读+新增覆盖"
 * 旧方案，见 DESIGN-BRIEF-round72-balance-history-edit.html）：改这条记录本身的
 * `amount`/`effectiveDate`，`computeHistoryEditFields` 顺带算出
 * `originalAmount`/`originalEffectiveDate` 该怎么变（详见该函数 + schema.ts
 * 表定义注释）。
 *
 * 编辑的是不是"当前生效"那条（`isCurrentBalanceHistoryEntry`）决定了要不要
 * 一并改钱包表本身：
 *
 * - 是：这次编辑等同于"重新设置了一次当前锚点"——先算 `displayBalanceBefore`
 *   （钱包现在真实状态，编辑前），写入 `wallets.currentBalance`/
 *   `balanceUpdatedAt`，重新查一次钱包算出 `displayBalanceAfter`，这条历史
 *   记录自己的 `displayBalanceAfter` 字段也要跟着更新成这个新算出的值（这个
 *   字段代表"这次设置动作之后余额变成多少"，编辑了金额，"之后"的值自然要跟着
 *   变）——但 `displayBalanceBefore` 这个历史记录自己的字段不动（那个字段代表
 *   "这次设置动作*之前*余额是多少"，跟这次编辑的目标值无关，保持历史真实性）。
 * - 不是：只改这条历史记录自己的字段，钱包表完全不碰，这条记录自己的
 *   `displayBalanceBefore`/`displayBalanceAfter` 两个字段也都不动。
 */
export const PATCH = withSession<Context>(async (request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const wallet = await loadOwnWallet(db, params.walletId, params.tripId, identity.participantId);
  if (!wallet) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const existingEntry = await loadOwnHistoryEntry(db, params.historyId, params.walletId);
  if (!existingEntry) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const parsed = await parseJsonBody(request, updateBalanceHistorySchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  const isCurrent = await isCurrentBalanceHistoryEntry(db, params.walletId, params.historyId);
  const editFields = computeHistoryEditFields(
    existingEntry,
    { amount: body.amount, effectiveDate: new Date(body.effectiveDate) },
    false
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
