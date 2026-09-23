import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { resolveUser, USER_SESSION_COOKIE_NAME } from '@/lib/auth/user-session';
import { hashPin } from '@/lib/auth/pin-hash';
import { validateRecoveryPin } from '@/lib/domain/recovery-pin';

export const dynamic = 'force-dynamic';

/**
 * 在 /account 页面设置（或重设）密码/PIN 找回口令。必须先登录才能设置——
 * 这是给已经在用这个账号的人多存一条"以后找回自己"的路，不是新的开号入口，
 * 所以要求当前请求已经带着有效的 tel_user_session。
 *
 * 允许覆盖旧值（改密码），不需要先验证旧密码——跟身份直连链接同一个信任层级：
 * 能拿到这条 cookie 就已经证明是本人，改自己的找回口令不用再验一遍。
 */
export async function POST(request: NextRequest) {
  const db = await getDb();
  const token = request.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
  const user = await resolveUser(db, token);
  if (!user) {
    return NextResponse.json({ error: 'not_logged_in' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { pin?: unknown } | null;
  const pin = typeof body?.pin === 'string' ? body.pin : '';
  const validation = validateRecoveryPin(pin);
  if (!validation.ok) {
    return NextResponse.json({ error: 'invalid_pin', message: validation.message }, { status: 400 });
  }

  const recoveryPinHash = await hashPin(pin);
  await db
    .update(users)
    .set({ recoveryPinHash, recoveryPinSetAt: new Date() })
    .where(eq(users.id, user.userId));

  return NextResponse.json({ ok: true, setAt: Date.now() });
}
