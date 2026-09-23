import { isNotNull } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { verifyPin } from '@/lib/auth/pin-hash';
import { extractClientIp, isRateLimited, recordAttempt } from '@/lib/auth/recovery-rate-limit';
import { createUserSession } from '@/lib/auth/user-session';
import { SESSION_COOKIE_NAME, linkCurrentTripSession } from '@/lib/auth/identity';
import { attachUserSessionCookie } from '@/lib/http/session-cookie';

export const dynamic = 'force-dynamic';

/**
 * 密码/PIN 找回，唯一不需要登录态就能换来登录态的路由——`/trips/new` 那道
 * "先确认一下"岔路新增的"我设过密码/PIN，直接找回"入口调这个。
 *
 * 只收密码本身，不收账号标识（邮箱/用户名都已经砍掉，没有这类字段可收）：
 * 逐个跟所有设过密码/PIN 的账号做常数时间比对，命中唯一才登录。这个设计
 * 本身也是隐私考量——不暴露"这个 PIN 属于哪个账号"这种信息，调用方只会
 * 看到"对/不对"。命中多个账号（两个人碰巧设了同一串密码）一律当作没命中，
 * 宁可让本人多联系一下自己确认，也不猜一个可能登错人的账号。
 *
 * 每次调用不管结果如何都计一次限流尝试（recordAttempt），防的是"打多少次"
 * 这个行为本身，不是只数失败——见 recovery-rate-limit.ts。
 */
export async function POST(request: NextRequest) {
  const db = await getDb();
  const ip = extractClientIp(request);

  if (await isRateLimited(db, ip)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as { pin?: unknown } | null;
  const pin = typeof body?.pin === 'string' ? body.pin : null;
  if (pin === null) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const candidates = await db
    .select({ id: users.id, recoveryPinHash: users.recoveryPinHash })
    .from(users)
    .where(isNotNull(users.recoveryPinHash));

  const matches = candidates.filter((c) => c.recoveryPinHash && verifyPin(pin, c.recoveryPinHash));

  await recordAttempt(db, ip);

  if (matches.length !== 1) {
    return NextResponse.json({ error: 'no_match' }, { status: 401 });
  }

  const matchedUserId = matches[0]!.id;
  const sessionToken = await createUserSession(db, matchedUserId, request.headers.get('user-agent'));

  const tripSessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  await linkCurrentTripSession(db, matchedUserId, tripSessionToken);

  const response = NextResponse.json({ ok: true as const });
  return attachUserSessionCookie(response, sessionToken);
}
