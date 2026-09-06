import type { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '../auth/session';
import { USER_SESSION_COOKIE_NAME } from '../auth/user-session';

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

/** Layer 2 账号登录态 cookie，形状跟 attachSessionCookie 一致，name 不同、互不干扰。 */
export function attachUserSessionCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set(USER_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
  });
  return response;
}

/** logout 用：把 tel_session + tel_user_session 两个 cookie 都清干净。 */
export function clearAllSessionCookies(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_COOKIE_NAME, '', { path: '/', maxAge: 0 });
  response.cookies.set(USER_SESSION_COOKIE_NAME, '', { path: '/', maxAge: 0 });
  return response;
}
