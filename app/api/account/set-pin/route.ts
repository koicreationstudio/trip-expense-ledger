import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { resolveUser, USER_SESSION_COOKIE_NAME } from '@/lib/auth/user-session';
import { hashPin } from '@/lib/auth/pin-hash';
import { validatePinFormat } from '@/lib/domain/recovery-pin';

export const dynamic = 'force-dynamic';

/**
 * 登录态下设置/更新自己的密码/PIN（`/account` 页面 SetPinForm 调用）。
 * 只认当前请求自己的 tel_user_session，不接受任何外部传参指定 userId——
 * 跟 link-current-trip / identity.ts 那批路由同一条安全边界。
 */
export async function POST(request: NextRequest) {
  const db = await getDb();
  const token = request.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
  const user = await resolveUser(db, token);
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { pin?: unknown } | null;
  const pin = typeof body?.pin === 'string' ? body.pin : null;
  if (pin === null) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const formatError = validatePinFormat(pin);
  if (formatError) {
    return NextResponse.json({ error: 'invalid_pin', message: formatError }, { status: 400 });
  }

  await db
    .update(users)
    .set({ recoveryPinHash: hashPin(pin), recoveryPinSetAt: new Date() })
    .where(eq(users.id, user.userId));

  return NextResponse.json({ ok: true as const });
}

/** 清除已设置的密码/PIN（Remy 想撤掉这条恢复路径时用）。 */
export async function DELETE(request: NextRequest) {
  const db = await getDb();
  const token = request.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
  const user = await resolveUser(db, token);
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  await db.update(users).set({ recoveryPinHash: null, recoveryPinSetAt: null }).where(eq(users.id, user.userId));

  return NextResponse.json({ ok: true as const });
}
