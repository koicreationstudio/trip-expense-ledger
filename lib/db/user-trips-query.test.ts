import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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

describe('loadUserTripsWithBalance expenseTotals 聚合查询容错', () => {
  it('聚合查询抛错时降级为 0，行程列表/净额照常返回，且 console.error 留痕', async () => {
    const trip = requireOne(
      await db.insert(trips).values({ name: '容错测试行程', baseCurrency: 'MYR' }).returning()
    );
    const user = requireOne(
      await db
        .insert(users)
        .values({ email: 'fallback-test@example.com', passwordHash: 'x', displayName: 'Fallback Tester' })
        .returning()
    );
    await db.insert(participants).values([
      { tripId: trip.id, displayName: 'Fallback Tester', isOwner: true, userId: user.id },
    ]);

    // 只伪造 expenseTotals 那条聚合查询（select 字段里带 total/count 是它独有的
    // 特征，跟同函数里 trips/participants join 那条、以及 loadSettlementInput
    // 里的两条查询都不冲突），其余 select 调用原样转发给真实 db，走真实 miniflare
    // D1，不整条链路都换成假数据。
    const originalSelect = db.select.bind(db);
    const selectSpy = vi.spyOn(db, 'select').mockImplementation(((fields: unknown) => {
      if (fields && typeof fields === 'object' && 'total' in fields && 'count' in fields) {
        return {
          from: () => ({
            where: () => ({
              groupBy: () => Promise.reject(new Error('模拟 expenseTotals 聚合查询瞬时故障')),
            }),
          }),
        };
      }
      return originalSelect(fields as Parameters<typeof originalSelect>[0]);
    }) as typeof db.select);

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const result = await loadUserTripsWithBalance(db, user.id);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(trip.id);
      // 净额走的是 loadSettlementInput 那条独立查询，没被伪造，照常算出来。
      expect(result[0]?.netBalance).toBe(0);
      // 聚合查询失败 → 降级成 0，不是 undefined、也不该把异常往上抛。
      expect(result[0]?.totalExpenseBaseCurrency).toBe(0);
      expect(result[0]?.expenseCount).toBe(0);
      expect(consoleErrorSpy).toHaveBeenCalled();
    } finally {
      selectSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });
});
