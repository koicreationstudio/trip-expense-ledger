import type { Config } from 'drizzle-kit';

// D1 底层就是 SQLite，dialect 不用变。这个配置只服务 `drizzle-kit generate`——
// 拿 schema.ts 跟 lib/db/migrations/meta 里的历史快照做 diff 生成新迁移文件，
// 全程只碰本地文件，不连任何真实数据库，所以不需要 dbCredentials。真正把
// 迁移应用到 D1（本地模拟或云端）走的是 `wrangler d1 migrations apply`，不
// 是 drizzle-kit，两边分工：drizzle-kit 产 SQL 文件，wrangler 执行 SQL 文件。
export default {
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'sqlite',
} satisfies Config;
