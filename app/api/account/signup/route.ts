import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { hashPassword } from '@/lib/auth/password';
import { createUserSession } from '@/lib/auth/user-session';
import { attachUserSessionCookie } from '@/lib/http/session-cookie';
import { toUserDto } from '@/lib/http/dto';
import { parseJsonBody } from '@/lib/http/validate';
import { signupSchema } from '@/lib/validation/schemas';

/**
 * Layer 2 账号注册：邮箱查重、hashPassword、种 tel_user_session cookie。
 * 完全不碰 Layer 1（tel_session/participant）——注册本身不认领任何行程身份。
 */
export async function POST(request: NextRequest) {
  const db = await getDb();
  const parsed = await parseJsonBody(request, signupSchema);
  if ('error' in parsed) return parsed.error;
  const { email, password, displayName } = parsed.data;

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) {
    return NextResponse.json({ error: 'email_taken' }, { status: 409 });
  }

  const userId = crypto.randomUUID();
  await db.insert(users).values({
    id: userId,
    email,
    passwordHash: hashPassword(password),
    displayName,
  });

  const token = await createUserSession(db, userId, request.headers.get('user-agent'));

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });

  const response = NextResponse.json({ user: toUserDto(user!) }, { status: 201 });
  return attachUserSessionCookie(response, token);
}
