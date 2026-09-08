import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { verifyPassword } from '@/lib/auth/password';
import { createUserSession } from '@/lib/auth/user-session';
import { attachUserSessionCookie } from '@/lib/http/session-cookie';
import { toUserDto } from '@/lib/http/dto';
import { parseJsonBody } from '@/lib/http/validate';
import { loginSchema } from '@/lib/validation/schemas';

/**
 * 找不到邮箱 / 密码错都返回同一个 401 文案，不区分两种情况——防止别人拿这个
 * 接口当"查邮箱是否已注册"的枚举工具。
 */
export async function POST(request: NextRequest) {
  const db = await getDb();
  const parsed = await parseJsonBody(request, loginSchema);
  if ('error' in parsed) return parsed.error;
  const { email, password } = parsed.data;

  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  const token = await createUserSession(db, user.id, request.headers.get('user-agent'));

  const response = NextResponse.json({ user: toUserDto(user) });
  return attachUserSessionCookie(response, token);
}
