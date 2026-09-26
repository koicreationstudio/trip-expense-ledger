import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDb, type Db } from '@/lib/db/client';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';

/**
 * scripts/backfill-settlement-confirmation-currency.sql 的本地验证测试。
 *
 * 这份脚本对"这个具体怎么处理"这个问题给出的答案（写在脚本文件顶部大注释里，
 * PM/Remy 核对用）：把历史遗留的整体确认行（currency IS NULL）展开成"迁移那一刻
 * 这对参与者实际涉及的每个币种各一行"，找不到匹配币种的历史行直接删掉，不产生
 * 新行。这里锁住三种场景，确保脚本真的照这个设计跑，不是纸面写了一套、SQL 实际
 * 又是另一套行为。
 */
let db: Db;

async function runStatements(multiStatementSql: string) {
  for (const statement of multiStatementSql.split(';')) {
    const trimmed = statement.trim();
    if (trimmed) await db.run(sql.raw(trimmed));
  }
}

async function runSqlFile(relativePath: string) {
  const fileContent = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
  await runStatements(fileContent);
}

async function queryConfirmations(tripId: string) {
  const rows = await db.run(
    sql.raw(
      `SELECT from_participant_id, to_participant_id, currency, confirmed_at FROM settlement_confirmation WHERE trip_id='${tripId}' ORDER BY currency`
    )
  );
  return (rows as unknown as { results: { from_participant_id: string; to_participant_id: string; currency: string | null; confirmed_at: number }[] })
    .results;
}

beforeAll(async () => {
  await setupTestDb();
  db = await getDb();
});

afterAll(async () => {
  await teardownTestDb();
});

describe('backfill-settlement-confirmation-currency.sql', () => {
  it('历史整体确认（currency IS NULL）按迁移那一刻实际涉及的币种展开成多行，confirmedAt 沿用原时间戳', async () => {
    await runStatements(`
      INSERT INTO trip (id, name, base_currency, status) VALUES ('sc-t1','测试行程','HKD','active');
      INSERT INTO participant (id, trip_id, display_name, is_owner) VALUES ('sc-pa','sc-t1','A',1),('sc-pb','sc-t1','B',0);
      INSERT INTO expense (id, trip_id, entered_by_participant_id, payer_participant_id, amount, currency, amount_base_currency, category, expense_date) VALUES
        ('sc-e1','sc-t1','sc-pa','sc-pa', 333, 'MYR', 172, 'food', 1000),
        ('sc-e2','sc-t1','sc-pa','sc-pa', 1000, 'HKD', 1000, 'food', 1000);
      INSERT INTO expense_split (expense_id, participant_id, share_amount_base_currency) VALUES
        ('sc-e1','sc-pa', 86),('sc-e1','sc-pb', 86),
        ('sc-e2','sc-pa', 500),('sc-e2','sc-pb', 500);
      INSERT INTO settlement_confirmation (id, trip_id, from_participant_id, to_participant_id, currency, confirmed_at) VALUES
        ('sc-c1','sc-t1','sc-pb','sc-pa', NULL, 12345);
    `);

    await runSqlFile('scripts/backfill-settlement-confirmation-currency.sql');

    const rows = await queryConfirmations('sc-t1');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.from_participant_id === 'sc-pb' && r.to_participant_id === 'sc-pa')).toBe(true);
    expect(rows.every((r) => r.confirmed_at === 12345)).toBe(true);
    expect(rows.map((r) => r.currency).sort()).toEqual(['HKD', 'MYR']);
    // 没有任何一行还是 NULL——旧的整体确认行已经被展开+删掉，不是留着一个模糊状态。
    expect(rows.some((r) => r.currency === null)).toBe(false);

    await runStatements(`
      DELETE FROM settlement_confirmation WHERE trip_id='sc-t1';
      DELETE FROM expense_split WHERE expense_id IN ('sc-e1','sc-e2');
      DELETE FROM expense WHERE trip_id='sc-t1';
      DELETE FROM participant WHERE trip_id='sc-t1';
      DELETE FROM trip WHERE id='sc-t1';
    `);
  });

  it('历史确认行对应的债务已经不存在了（比如账目被编辑过），只删掉这行，不凭空生出一行新确认', async () => {
    await runStatements(`
      INSERT INTO trip (id, name, base_currency, status) VALUES ('sc-t2','测试行程2','HKD','active');
      INSERT INTO participant (id, trip_id, display_name, is_owner) VALUES ('sc-pc','sc-t2','C',1),('sc-pd','sc-t2','D',0);
      INSERT INTO settlement_confirmation (id, trip_id, from_participant_id, to_participant_id, currency, confirmed_at) VALUES
        ('sc-c2','sc-t2','sc-pd','sc-pc', NULL, 99999);
    `);
    // 注意：这趟行程没有任何 expense，pd 对 pc 完全不欠钱——模拟"记录时确实欠钱，
    // 后来消费被删/编辑掉，债务已经不在了"这种场景。

    await runSqlFile('scripts/backfill-settlement-confirmation-currency.sql');

    const rows = await queryConfirmations('sc-t2');
    expect(rows).toHaveLength(0); // 干净删掉，没有留下任何行（不是全部币种都标成已收）

    await runStatements(`
      DELETE FROM settlement_confirmation WHERE trip_id='sc-t2';
      DELETE FROM participant WHERE trip_id='sc-t2';
      DELETE FROM trip WHERE id='sc-t2';
    `);
  });

  it('幂等：重复跑不会产生重复行（第二次跑时已经没有 currency IS NULL 的历史行了）', async () => {
    await runStatements(`
      INSERT INTO trip (id, name, base_currency, status) VALUES ('sc-t3','幂等测试行程','SGD','active');
      INSERT INTO participant (id, trip_id, display_name, is_owner) VALUES ('sc-pe','sc-t3','E',1),('sc-pf','sc-t3','F',0);
      INSERT INTO expense (id, trip_id, entered_by_participant_id, payer_participant_id, amount, currency, amount_base_currency, category, expense_date) VALUES
        ('sc-e3','sc-t3','sc-pe','sc-pe', 1000, 'SGD', 1000, 'food', 1000);
      INSERT INTO expense_split (expense_id, participant_id, share_amount_base_currency) VALUES
        ('sc-e3','sc-pe', 500),('sc-e3','sc-pf', 500);
      INSERT INTO settlement_confirmation (id, trip_id, from_participant_id, to_participant_id, currency, confirmed_at) VALUES
        ('sc-c3','sc-t3','sc-pf','sc-pe', NULL, 11111);
    `);

    await runSqlFile('scripts/backfill-settlement-confirmation-currency.sql');
    const firstRun = await queryConfirmations('sc-t3');
    expect(firstRun).toHaveLength(1);

    await runSqlFile('scripts/backfill-settlement-confirmation-currency.sql');
    const secondRun = await queryConfirmations('sc-t3');
    expect(secondRun).toEqual(firstRun); // 完全不变，没有多出重复行

    await runStatements(`
      DELETE FROM settlement_confirmation WHERE trip_id='sc-t3';
      DELETE FROM expense_split WHERE expense_id='sc-e3';
      DELETE FROM expense WHERE trip_id='sc-t3';
      DELETE FROM participant WHERE trip_id='sc-t3';
      DELETE FROM trip WHERE id='sc-t3';
    `);
  });
});
