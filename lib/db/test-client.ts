import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { PlatformProxy } from 'wrangler';
import * as schema from './schema';
import { __setTestD1Provider } from './client';

/**
 * 测试专用：只被 *.test.ts 引用，绝对不能被 app/ 下任何 route.ts/page.tsx 引用——
 * 那样会把这个文件（以及它对 wrangler 的依赖）拖进 Next 生产构建的入口图，
 * wrangler 整个 CLI 打进 Worker 产物会直接炸构建。
 */

let testProxy: PlatformProxy<{ DB: D1Database }> | null = null;

async function getTestD1(): Promise<D1Database> {
  if (!testProxy) {
    // vitest 没有真实 Workers 请求上下文，getCloudflareContext() 拿不到 env——
    // 用 wrangler 的 getPlatformProxy() 换一套本地 miniflare 模拟出的真实 D1
    // binding（不是另一套 driver，行为跟生产一致，.batch() 等 D1 专属 API 照样
    // 能测）。persist: false 保证每次测试进程都是全新空库，不会跨次运行残留数据。
    const { getPlatformProxy } = await import('wrangler');
    testProxy = await getPlatformProxy<{ DB: D1Database }>({ persist: false });
  }
  return testProxy.env.DB;
}

/**
 * vitest beforeAll 调这个一次：把 lib/db/client.ts 的 getDb() 接到本地测试 D1
 * 上，再读 lib/db/migrations 里的 SQL 文件建表。
 */
export async function setupTestDb(): Promise<void> {
  __setTestD1Provider(getTestD1);

  const fs = await import('node:fs');
  const path = await import('node:path');
  const d1 = await getTestD1();
  const testDb = drizzle(d1, { schema });
  const migrationsDir = path.join(process.cwd(), 'lib/db/migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const fileContent = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    // drizzle-kit 生成的迁移文件用 `--> statement-breakpoint` 当分隔符（不是
    // 靠分号，字段定义里本来就有很多分号无关的逗号）。D1Database.exec() 又有
    // 个已知坑：它内部按换行切分输入再逐行跑，会把一条跨多行的 CREATE TABLE
    // 从中间切断报语法错——所以不用 d1.exec()，改用 drizzle 的 db.run()，走
    // .prepare(sql).run() 这条路径，一条完整语句原样送进去，不会被再拆。
    for (const statement of fileContent.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) await testDb.run(sql.raw(trimmed));
    }
  }
}

/** vitest afterAll 调这个一次：关掉 miniflare 子进程，把注入点还原。 */
export async function teardownTestDb(): Promise<void> {
  __setTestD1Provider(null);
  if (testProxy) {
    await testProxy.dispose();
    testProxy = null;
  }
}
