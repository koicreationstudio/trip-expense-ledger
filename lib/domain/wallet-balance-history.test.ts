import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, type Db } from '@/lib/db/client';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';
import { participants, trips, walletBalanceHistory, wallets } from '@/lib/db/schema';
import { computeHistoryEditFields, isCurrentBalanceHistoryEntry } from './wallet-balance-history';

/**
 * round72 第三批（余额历史可直接编辑）：`computeHistoryEditFields` 是纯函数，
 * 直接单测；`isCurrentBalanceHistoryEntry` 要摸真的 DB（判断依据是"这个钱包
 * changedAt 最大的那条"），走真实 miniflare D1（setupTestDb），跟
 * lib/domain/wallet-balance.test.ts 同一套模式。
 */

describe('computeHistoryEditFields（纯函数，不摸 DB）', () => {
  const baseRow = {
    amount: 100000,
    effectiveDate: new Date('2026-09-20T00:00:00.000Z'),
    originalAmount: null as number | null,
    originalEffectiveDate: null as Date | null,
  };

  it('第一次编辑：originalAmount/originalEffectiveDate 从 null 变成"编辑前"的旧值', () => {
    const target = { amount: 120000, effectiveDate: new Date('2026-09-21T00:00:00.000Z') };
    const result = computeHistoryEditFields(baseRow, target, false);

    expect(result.amount).toBe(120000);
    expect(result.effectiveDate).toEqual(new Date('2026-09-21T00:00:00.000Z'));
    // 原始值捕获的是"这次编辑之前"的旧值，不是这次编辑的目标值。
    expect(result.originalAmount).toBe(100000);
    expect(result.originalEffectiveDate).toEqual(new Date('2026-09-20T00:00:00.000Z'));
  });

  it('第二次编辑同一条：originalAmount 维持第一次编辑前捕获的值，不被第二次编辑的"编辑前"值（中间值）覆盖', () => {
    // 模拟"第一次编辑已经发生过"之后的行状态：amount/effectiveDate 已经变成第一次
    // 编辑的结果（中间值 120000），originalAmount/originalEffectiveDate 是第一次
    // 编辑时捕获的最初原始值（100000）。
    const rowAfterFirstEdit = {
      amount: 120000,
      effectiveDate: new Date('2026-09-21T00:00:00.000Z'),
      originalAmount: 100000,
      originalEffectiveDate: new Date('2026-09-20T00:00:00.000Z'),
    };
    const secondTarget = { amount: 150000, effectiveDate: new Date('2026-09-22T00:00:00.000Z') };

    const result = computeHistoryEditFields(rowAfterFirstEdit, secondTarget, false);

    expect(result.amount).toBe(150000);
    expect(result.effectiveDate).toEqual(new Date('2026-09-22T00:00:00.000Z'));
    // 关键断言：这里故意设计成"如果代码写错、把 originalAmount 覆盖成第二次编辑前
    // 的中间值 120000"就会失败——正确实现必须还是第一次编辑前的最初原始值 100000，
    // 不是 120000（这个中间值）。
    expect(result.originalAmount).toBe(100000);
    expect(result.originalAmount).not.toBe(120000);
    expect(result.originalEffectiveDate).toEqual(new Date('2026-09-20T00:00:00.000Z'));
    expect(result.originalEffectiveDate).not.toEqual(new Date('2026-09-21T00:00:00.000Z'));
  });

  it('还原（isRevert=true）：amount/effectiveDate 变回 row.originalAmount/row.originalEffectiveDate，原始值字段清空成 null', () => {
    const rowWithOriginal = {
      amount: 150000, // 当前值（被编辑过好几次之后的最新值）
      effectiveDate: new Date('2026-09-22T00:00:00.000Z'),
      originalAmount: 100000,
      originalEffectiveDate: new Date('2026-09-20T00:00:00.000Z'),
    };
    // isRevert=true 时，调用方按规格传入的 target 就是 row.originalAmount/
    // row.originalEffectiveDate 本身（函数不重新去读，直接信调用方传的）。
    const target = { amount: rowWithOriginal.originalAmount, effectiveDate: rowWithOriginal.originalEffectiveDate };

    const result = computeHistoryEditFields(rowWithOriginal, target, true);

    expect(result.amount).toBe(100000);
    expect(result.effectiveDate).toEqual(new Date('2026-09-20T00:00:00.000Z'));
    expect(result.originalAmount).toBeNull();
    expect(result.originalEffectiveDate).toBeNull();
  });
});

describe('isCurrentBalanceHistoryEntry（摸真实测试 D1）', () => {
  let db: Db;

  beforeAll(async () => {
    await setupTestDb();
    db = await getDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  async function makeTripWalletParticipant() {
    const tripId = crypto.randomUUID();
    await db.insert(trips).values({ id: tripId, name: '测试行程', baseCurrency: 'USD' });
    const participantId = crypto.randomUUID();
    await db.insert(participants).values({ id: participantId, tripId, displayName: '测试者', isOwner: true });
    const walletId = crypto.randomUUID();
    await db.insert(wallets).values({
      id: walletId,
      tripId,
      participantId,
      label: '测试钱包',
      currency: 'USD',
      currentBalance: 0,
      balanceUpdatedAt: null,
    });
    return { tripId, participantId, walletId };
  }

  async function insertHistory(args: {
    walletId: string;
    participantId: string;
    amount: number;
    effectiveDate: Date;
    changedAt: Date;
  }) {
    const id = crypto.randomUUID();
    await db.insert(walletBalanceHistory).values({
      id,
      walletId: args.walletId,
      amount: args.amount,
      effectiveDate: args.effectiveDate,
      changedByParticipantId: args.participantId,
      changedAt: args.changedAt,
      displayBalanceBefore: 0,
      displayBalanceAfter: args.amount,
    });
    return id;
  }

  it('只有一条历史时，那条就是当前生效', async () => {
    const { walletId, participantId } = await makeTripWalletParticipant();
    const onlyId = await insertHistory({
      walletId,
      participantId,
      amount: 1000,
      effectiveDate: new Date('2026-09-20T00:00:00.000Z'),
      changedAt: new Date('2026-09-20T00:00:00.000Z'),
    });

    expect(await isCurrentBalanceHistoryEntry(db, walletId, onlyId)).toBe(true);
  });

  it('有多条历史时，changedAt 最大的那条是当前生效，旧的那条不是', async () => {
    const { walletId, participantId } = await makeTripWalletParticipant();
    const olderId = await insertHistory({
      walletId,
      participantId,
      amount: 1000,
      effectiveDate: new Date('2026-09-20T00:00:00.000Z'),
      changedAt: new Date('2026-09-20T00:00:00.000Z'),
    });
    const newerId = await insertHistory({
      walletId,
      participantId,
      amount: 2000,
      effectiveDate: new Date('2026-09-24T00:00:00.000Z'),
      changedAt: new Date('2026-09-24T00:00:00.000Z'),
    });

    expect(await isCurrentBalanceHistoryEntry(db, walletId, newerId)).toBe(true);
    expect(await isCurrentBalanceHistoryEntry(db, walletId, olderId)).toBe(false);
  });

  it('边界：旧记录的 effectiveDate 被手动改得比"当前生效"那条还晚，也不会被带偏——判断永远看 changedAt，不看 effectiveDate', async () => {
    const { walletId, participantId } = await makeTripWalletParticipant();
    // olderId：changedAt 更早（是真正"较早创建"的那条），但故意把它的 effectiveDate
    // 设置成比 newerId 还晚——模拟"编辑历史条目、把生效日改到比当前生效那条还晚"
    // 这个背景说明②里点名的边界场景。
    const olderId = await insertHistory({
      walletId,
      participantId,
      amount: 1000,
      effectiveDate: new Date('2026-12-31T00:00:00.000Z'), // 故意设置成最晚的生效日
      changedAt: new Date('2026-09-20T00:00:00.000Z'),
    });
    const newerId = await insertHistory({
      walletId,
      participantId,
      amount: 2000,
      effectiveDate: new Date('2026-09-24T00:00:00.000Z'), // 生效日比 olderId 早得多
      changedAt: new Date('2026-09-24T00:00:00.000Z'), // 但 changedAt 是最大的
    });

    // 仍然认 changedAt 最大的 newerId 是当前生效，不会被 olderId 更晚的 effectiveDate 带偏。
    expect(await isCurrentBalanceHistoryEntry(db, walletId, newerId)).toBe(true);
    expect(await isCurrentBalanceHistoryEntry(db, walletId, olderId)).toBe(false);
  });
});
