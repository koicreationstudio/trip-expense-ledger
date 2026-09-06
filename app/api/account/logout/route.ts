import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { revokeUserSession, USER_SESSION_COOKIE_NAME } from '@/lib/auth/user-session';
import { clearAllSessionCookies } from '@/lib/http/session-cookie';

/** 清 tel_session + tel_user_session 两个 cookie，都删干净，跳回 /。 */
export async function POST(request: NextRequest) {
  const userToken = request.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
  if (userToken) {
    await revokeUserSession(db, userToken);
  }

  const response = NextResponse.json({ ok: true });
  return clearAllSessionCookies(response);
}
