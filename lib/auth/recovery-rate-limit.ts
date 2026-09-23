import crypto from 'node:crypto';
import { and, gte, eq, count } from 'drizzle-orm';
import type { Db } from '../db/client';
import { recoveryAttempts } from '../db/schema';

/**
 * /api/account/recover-pin 是唯一一条不需要登录、只靠一段密码/PIN 就能换来
 * 登录态的路由——不限流的话就是一个可以无限次线上撞库的入口。窗口/上限
 * 数字跟 round30 那版设计一致（15 分钟 10 次），这次真正落地验证。
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 10;

/** IP 不明文落库，同 session 表"cookie 放明文、DB 只存 hash"的隐私原则。 */
function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

/**
 * 从请求头拿调用方 IP。Cloudflare 边缘请求一律带 `cf-connecting-ip`；本地
 * `wrangler dev`/vitest 环境拿不到时退化成固定桶 'local-dev'——效果是本地
 * 开发环境下所有请求共享同一个限流桶，这是可接受的开发期行为，不是生产
 * 路径会走到的分支。
 */
export function extractClientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local-dev';
}

/**
 * 记一次尝试（不管成功失败都记——限流防的是"打多少次"这个行为本身，不是
 * 只数失败次数；否则攻击者可以用一次次"先猜对再猜错"把计数刷掉）。
 */
export async function recordAttempt(db: Db, ip: string): Promise<void> {
  await db.insert(recoveryAttempts).values({ ipHash: hashIp(ip) });
}

/** 这个 IP 最近 15 分钟内是不是已经打满 10 次，打满了就该拒绝这次请求。 */
export async function isRateLimited(db: Db, ip: string): Promise<boolean> {
  const ipHash = hashIp(ip);
  const windowStart = new Date(Date.now() - WINDOW_MS);
  const row = await db
    .select({ n: count() })
    .from(recoveryAttempts)
    .where(and(eq(recoveryAttempts.ipHash, ipHash), gte(recoveryAttempts.createdAt, windowStart)))
    .get();
  return (row?.n ?? 0) >= MAX_ATTEMPTS_PER_WINDOW;
}
