import type { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '../auth/session';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** 认领/创建行程成功后统一走这里下发 session cookie，明文 token 只活在这一次响应里。 */
export function attachSessionCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
  });
  return response;
}
