import { isNotNull } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { createUserSession } from '@/lib/auth/user-session';
import { verifyPin } from '@/lib/auth/pin-hash';
import { validateRecoveryPin } from '@/lib/domain/recovery-pin';
import { SESSION_COOKIE_NAME, linkCurrentTripSession } from '@/lib/auth/identity';
import { attachUserSessionCookie } from '@/lib/http/session-cookie';
import { clientKeyFromRequest, isRateLimited, recordFailedAttempt } from '@/lib/auth/recovery-rate-limit';

export const dynamic = 'force-dynamic';

/**
 * 密码/PIN 找回：身份直连链接之外第二条恢复路径（Remy 明确要——链接太难记，
 * 想要一个自己设的密码/PIN 就能找回，不是取代链接，链接机制原样保留）。
 *
 * 这个接口只收一个密码，不收账号标识（provision-gate 的入口文案就是"我知道
 * 密码，直接找回"，不是"输入账号名+密码"两个框）。校验逻辑：拿所有设置过
 * 找回口令的账号（正常情况下只有 1、2 个真实账号会设置这个），逐个用常量
 * 时间比较验证，命中唯一一个才登录；命中 0 个或命中多个（理论上极小概率，
 * 说明有人设了同一个密码）都当失败处理，不猜一个登进去——账号找回场景下
 * "宁可拒绝，不可能登错人"。
 */
export async function POST(request: NextRequest) {
  const db = await getDb();
  const clientKey = clientKeyFromRequest(request);

  if (await isRateLimited(db, clientKey)) {
    return NextResponse.json({ error: 'rate_limited', message: '尝试次数太多，过一会儿再试' }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as { pin?: unknown } | null;
  const pin = typeof body?.pin === 'string' ? body.pin : '';
  const validation = validateRecoveryPin(pin);
  if (!validation.ok) {
    await recordFailedAttempt(db, clientKey);
    return NextResponse.json({ error: 'no_match', message: '密码不对，或者这个账号还没设置过找回密码' }, {
      status: 401,
    });
  }

  const candidates = await db
    .select({ id: users.id, recoveryPinHash: users.recoveryPinHash })
    .from(users)
    .where(isNotNull(users.recoveryPinHash));

  const matches: string[] = [];
  for (const candidate of candidates) {
    if (candidate.recoveryPinHash && (await verifyPin(pin, candidate.recoveryPinHash))) {
      matches.push(candidate.id);
    }
  }

  const [userId, ...rest] = matches;
  if (!userId || rest.length > 0) {
    await recordFailedAttempt(db, clientKey);
    return NextResponse.json({ error: 'no_match', message: '密码不对，或者这个账号还没设置过找回密码' }, {
      status: 401,
    });
  }

  const sessionToken = await createUserSession(db, userId, request.headers.get('user-agent'));

  const tripSessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  await linkCurrentTripSession(db, userId, tripSessionToken);

  const response = NextResponse.json({ ok: true });
  return attachUserSessionCookie(response, sessionToken);
}
