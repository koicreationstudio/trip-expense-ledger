import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, type Db } from './client';
import { setupTestDb, teardownTestDb } from './test-client';
import { trips, users, participants } from './schema';
import { loadUserTripsWithBalance } from './user-trips-query';

/**
 * 回归测试：同一账号既是某行程创建者、又用邀请链接认领了该行程里另一个
 * 参与者占位时，底层 join 会把同一个 trip 连出两行——这次修复前，
 * app/my-trips.tsx 用 trip.id 当 React key 直接撞车，还会渲染成两张
 * 重复卡片（ui-auditor 全站走查实测复现，见 project_trip_expense_ledger_v01
 * 第十一轮）。这里直接测底层查询函数，不用走完整的建号/认领 API 流程。
 */

let db: Db;

function requireOne<T>(rows: T[]): T {
  const [first] = rows;
  if (!first) throw new Error('insert 没有返回行，测试数据没建成功');
  return first;
}

beforeAll(async () => {
  await setupTestDb();
  db = await getDb();
});

afterAll(async () => {
  await teardownTestDb();
});

describe('loadUserTripsWithBalance 去重', () => {
  it('同一账号在同一行程身兼创建者+认领身份时，只返回一行且保留创建者身份', async () => {
    const trip = requireOne(
      await db.insert(trips).values({ name: '去重测试行程', baseCurrency: 'MYR' }).returning()
    );
    const user = requireOne(
      await db
        .insert(users)
        .values({ email: 'dedup-test@example.com', passwordHash: 'x', displayName: 'Dedup Tester' })
        .returning()
    );

    // 同一个 userId 关联两个 participant：一个是创建者、一个是后来认领的同行人占位。
    await db.insert(participants).values([
      { tripId: trip.id, displayName: 'Dedup Tester', isOwner: true, userId: user.id },
      { tripId: trip.id, displayName: '同行人占位', isOwner: false, userId: user.id },
    ]);

    const result = await loadUserTripsWithBalance(db, user.id);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(trip.id);
    expect(result[0]?.isOwner).toBe(true);
  });

  it('没有身份重叠时正常返回各自一行，不会误去重', async () => {
    const tripA = requireOne(await db.insert(trips).values({ name: '行程A', baseCurrency: 'MYR' }).returning());
    const tripB = requireOne(await db.insert(trips).values({ name: '行程B', baseCurrency: 'THB' }).returning());
    const user = requireOne(
      await db
        .insert(users)
        .values({ email: 'no-overlap-test@example.com', passwordHash: 'x', displayName: 'No Overlap' })
        .returning()
    );

    await db.insert(participants).values([
      { tripId: tripA.id, displayName: 'No Overlap', isOwner: true, userId: user.id },
      { tripId: tripB.id, displayName: 'No Overlap', isOwner: false, userId: user.id },
    ]);

    const result = await loadUserTripsWithBalance(db, user.id);
    const ids = result.map((r) => r.id).sort();

    expect(result).toHaveLength(2);
    expect(ids).toEqual([tripA.id, tripB.id].sort());
  });
});
