import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { participants } from '@/lib/db/schema';
import { resolveIdentity, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { resolveUser, USER_SESSION_COOKIE_NAME } from '@/lib/auth/user-session';

/**
 * "顺手注册"用：拿当前有效的 tel_session（Layer 1，刚认领完邀请或刚建完行程
 * 但还没登录账号）+ 新登录/注册的 tel_user_session（Layer 2），
 * 把这个 participant 的 userId 补上，打通两层身份。
 *
 * 只操作"当前这个浏览器自己 session 指向的 participant"，不接受任何客户端
 * 传参指定 participantId——跟 Layer 1 权限边界的原则一致，防止越权关联别人的行程身份。
 */
export async function POST(request: NextRequest) {
  const db = await getDb();
  const userToken = request.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
  const user = await resolveUser(db, userToken);
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const identity = await resolveIdentity(db, sessionToken);
  if (!identity) {
    // 没有活跃 tel_session 是"顺手注册"场景里完全正常的一种结果（比如直接从首页登录，
    // 不是刚认领完邀请/建完行程），不是请求出错，用 200+ok:false 表达，避免每次常规登录都在
    // 浏览器 console 打一条红色 400，误导人以为哪里坏了。
    return NextResponse.json({ ok: false, reason: 'no_active_trip_session' }, { status: 200 });
  }

  await db.update(participants).set({ userId: user.userId }).where(eq(participants.id, identity.participantId));

  return NextResponse.json({ ok: true, tripId: identity.tripId });
}
