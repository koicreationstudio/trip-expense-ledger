import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { resolveUser, USER_SESSION_COOKIE_NAME } from '@/lib/auth/user-session';
import { linkCurrentTripSession } from '@/lib/auth/identity';

/**
 * "顺手关联"用：拿当前有效的 tel_session（Layer 1，刚认领完邀请但还没登录
 * 账号）+ 当前 tel_user_session（Layer 2），把这个 participant 的 userId 补上，
 * 打通两层身份。核心逻辑在 lib/auth/identity.ts 的 linkCurrentTripSession()，
 * app/id/[token]/route.ts（身份直连链接登录）也调用同一个函数，不重复实现。
 */
export async function POST(request: NextRequest) {
  const db = await getDb();
  const userToken = request.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
  const user = await resolveUser(db, userToken);
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const result = await linkCurrentTripSession(db, user.userId, sessionToken);

  if (!result.ok) {
    // 没有活跃 tel_session 是"顺手关联"场景里完全正常的一种结果（比如直接从
    // 首页开号，不是刚认领完邀请/建完行程），不是请求出错，用 200+ok:false
    // 表达，避免每次常规操作都在浏览器 console 打一条红色 400。
    return NextResponse.json({ ok: false, reason: 'no_active_trip_session' }, { status: 200 });
  }

  return NextResponse.json({ ok: true, tripId: result.tripId });
}
