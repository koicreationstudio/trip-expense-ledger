import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { resolveUser, USER_SESSION_COOKIE_NAME } from '@/lib/auth/user-session';
import { provisionUser } from '@/lib/auth/identity';
import { attachUserSessionCookie } from '@/lib/http/session-cookie';

// 不读 cookies/headers 之外没有别的动态输入，但这个路由本身就是「每次请求
// 都要反映当下 cookie 状态」的典型场景，显式声明防止被 Next 静态预渲染缓存
// （这个项目 lib/health route 踩过的坑，见项目 memory）。
export const dynamic = 'force-dynamic';

/**
 * 邮箱密码登录砍掉后，第一次进 /trips/new 没有账号时调用这个现铸一个新账号。
 * 幂等：已经有有效 tel_user_session 就不重复开号，直接告诉调用方
 * "已经有账号了"，防止重复点击/竞态创建出孤儿账号。
 */
export async function POST(request: NextRequest) {
  const db = await getDb();
  const existingToken = request.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
  const existingUser = await resolveUser(db, existingToken);
  if (existingUser) {
    return NextResponse.json({ alreadyProvisioned: true as const });
  }

  const { identityToken, sessionToken } = await provisionUser(db, request.headers.get('user-agent'));
  const identityUrl = new URL(`/id/${identityToken}`, request.url).toString();

  const response = NextResponse.json({ alreadyProvisioned: false as const, identityUrl });
  return attachUserSessionCookie(response, sessionToken);
}
