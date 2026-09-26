import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDb, type Db } from '@/lib/db/client';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';

/**
 * scripts/backfill-expense-split-original-currency.sql 的本地验证测试：确认这份
 * SQL 语法没问题（真的能在应用过全部 migration 的本地 D1 上跑），也确认回填公式
 * 算出来的数字符合预期（比例反推，允许几分钱的近似误差，见脚本文件顶部注释），
 * 不是只手写了 SQL 没验证过就交出去。
 */
let db: Db;

async function runSqlFile(relativePath: string) {
  const fileContent = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
  for (const statement of fileContent.split(';')) {
    const trimmed = statement.trim();
    if (trimmed) await db.run(sql.raw(trimmed));
  }
}

/** 测试用小 helper：一段多语句 SQL（用 ; 分隔）逐条执行，不依赖 D1 一次能跑多条语句。 */
async function runStatements(multiStatementSql: string) {
  for (const statement of multiStatementSql.split(';')) {
    const trimmed = statement.trim();
    if (trimmed) await db.run(sql.raw(trimmed));
  }
}

beforeAll(async () => {
  await setupTestDb();
  db = await getDb();
});

afterAll(async () => {
  await teardownTestDb();
});

describe('backfill-expense-split-original-currency.sql', () => {
  it('按比例回填 share_amount_original，本位币=原始币种时精确无误差，换算过的币种允许几分钱近似误差', async () => {
    await runStatements(`
      INSERT INTO trip (id, name, base_currency, status) VALUES ('bf-t1','回填测试行程','HKD','active');
      INSERT INTO participant (id, trip_id, display_name, is_owner) VALUES ('bf-pa','bf-t1','A',1),('bf-pb','bf-t1','B',0);
      INSERT INTO expense (id, trip_id, entered_by_participant_id, payer_participant_id, amount, currency, amount_base_currency, category, expense_date) VALUES
        ('bf-e1','bf-t1','bf-pa','bf-pa', 333, 'MYR', 172, 'food', 1000),
        ('bf-e2','bf-t1','bf-pa','bf-pa', 1000, 'HKD', 1000, 'food', 1000);
      INSERT INTO expense_split (expense_id, participant_id, share_amount_base_currency) VALUES
        ('bf-e1','bf-pa', 86),('bf-e1','bf-pb', 86),
        ('bf-e2','bf-pa', 500),('bf-e2','bf-pb', 500);
    `);

    await runSqlFile('scripts/backfill-expense-split-original-currency.sql');

    const rows = await db.run(
      sql.raw(
        `SELECT expense_id, participant_id, share_amount_base_currency, share_amount_original FROM expense_split WHERE expense_id IN ('bf-e1','bf-e2') ORDER BY expense_id, participant_id`
      )
    );
    const results = (rows as unknown as { results: Record<string, unknown>[] }).results;

    // HKD 本身就是本位币，回填应该精确无误差：500/1000 * 1000 = 500。
    const hkdRows = results.filter((r) => r.expense_id === 'bf-e2');
    expect(hkdRows.every((r) => r.share_amount_original === 500)).toBe(true);

    // MYR 是换算过的币种，86/172*333=166.5，四舍五入到 167——两份各自独立四舍五入，
    // 总和 334 跟原始 333 差 1 分钱，这是脚本注释里写明的已知近似误差，不是 bug。
    const myrRows = results.filter((r) => r.expense_id === 'bf-e1');
    expect(myrRows.every((r) => r.share_amount_original === 167)).toBe(true);

    await db.run(sql.raw(`DELETE FROM expense_split WHERE expense_id IN ('bf-e1','bf-e2');`));
    await db.run(sql.raw(`DELETE FROM expense WHERE trip_id='bf-t1';`));
    await db.run(sql.raw(`DELETE FROM participant WHERE trip_id='bf-t1';`));
    await db.run(sql.raw(`DELETE FROM trip WHERE id='bf-t1';`));
  });

  it('幂等：重复跑同一份脚本，结果不变（不会因为跑第二次就把数字改错）', async () => {
    await runStatements(`
      INSERT INTO trip (id, name, base_currency, status) VALUES ('bf-t2','回填幂等测试','SGD','active');
      INSERT INTO participant (id, trip_id, display_name, is_owner) VALUES ('bf-pc','bf-t2','C',1);
      INSERT INTO expense (id, trip_id, entered_by_participant_id, payer_participant_id, amount, currency, amount_base_currency, category, expense_date) VALUES
        ('bf-e3','bf-t2','bf-pc','bf-pc', 777, 'CNY', 148, 'food', 1000);
      INSERT INTO expense_split (expense_id, participant_id, share_amount_base_currency) VALUES ('bf-e3','bf-pc', 148);
    `);

    await runSqlFile('scripts/backfill-expense-split-original-currency.sql');
    const first = await db.run(sql.raw(`SELECT share_amount_original FROM expense_split WHERE expense_id='bf-e3'`));
    await runSqlFile('scripts/backfill-expense-split-original-currency.sql');
    const second = await db.run(sql.raw(`SELECT share_amount_original FROM expense_split WHERE expense_id='bf-e3'`));

    expect((first as unknown as { results: { share_amount_original: number }[] }).results).toEqual(
      (second as unknown as { results: { share_amount_original: number }[] }).results
    );

    await db.run(sql.raw(`DELETE FROM expense_split WHERE expense_id='bf-e3';`));
    await db.run(sql.raw(`DELETE FROM expense WHERE trip_id='bf-t2';`));
    await db.run(sql.raw(`DELETE FROM participant WHERE trip_id='bf-t2';`));
    await db.run(sql.raw(`DELETE FROM trip WHERE id='bf-t2';`));
  });
});
