import crypto from 'node:crypto';
import { gt, and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { recoveryPinAttempts } from '../db/schema';

/**
 * 密码/PIN 找回接口没有账号名做二次限定（只输密码），限流按请求来源
 * （cf-connecting-ip 哈希）记失败次数，15 分钟窗口内失败达到阈值就拒绝，
 * 只记失败不记成功——正常用户自己密码输对了不会被卡。
 *
 * clientKey 用哈希不用明文 IP：这条记录会积在 D1 里，没必要留明文 IP 这种
 * 可识别个人的数据，哈希已经足够做"同一来源"判断。
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 10;

export function clientKeyFromRequest(request: Request): string {
  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? 'unknown';
  return crypto.createHash('sha256').update(ip).digest('hex');
}

/** 查这个来源最近 15 分钟内失败次数有没有超阈值。 */
export async function isRateLimited(db: Db, clientKey: string): Promise<boolean> {
  const windowStart = new Date(Date.now() - WINDOW_MS);
  const row = await db
    .select({ count: sql<number>`count(*)` })
    .from(recoveryPinAttempts)
    .where(and(eq(recoveryPinAttempts.clientKey, clientKey), gt(recoveryPinAttempts.createdAt, windowStart)))
    .get();
  return (row?.count ?? 0) >= MAX_ATTEMPTS_PER_WINDOW;
}

/** 记一次失败尝试。 */
export async function recordFailedAttempt(db: Db, clientKey: string): Promise<void> {
  await db.insert(recoveryPinAttempts).values({ clientKey });
}
