import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { createUserSession } from '@/lib/auth/user-session';
import { SESSION_COOKIE_NAME, linkCurrentTripSession } from '@/lib/auth/identity';
import { attachUserSessionCookie } from '@/lib/http/session-cookie';

// 动态路由段本身不保证 Next 一定按需渲染这个 route handler——项目 memory 记过
// 一个坑：不读 cookies/headers/searchParams 的 handler 会被默认静态预渲染
// 缓存。这里虽然靠 [token] 参数区分请求，仍然显式声明防止同类坑复发。
export const dynamic = 'force-dynamic';

/**
 * 专属身份直连链接：邮箱密码登录砍掉后，这是重新进入自己账号唯一的入口
 * （2026-09-09 第十六轮登录系统换血）。token 明文比对（同 invite.code 一样
 * 的存储哲学），查到了就现铸新的 tel_user_session 覆盖 cookie，顺手把当前
 * 活跃的 Layer 1 tel_session（比如刚认领完邀请）关联到这个账号——跟
 * link-current-trip 完全一样的安全边界，只认当前请求自己的 session，
 * 不接受外部传参指定 participantId。
 *
 * 查不到 token（链接无效/打错字）一律跳回首页带错误态查询参数，不暴露
 * "这个 token 曾经存在过"这类信息。
 */
export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  const db = await getDb();
  const user = await db.query.users.findFirst({ where: eq(users.identityToken, params.token) });

  if (!user) {
    return NextResponse.redirect(new URL('/?identity_invalid=1', request.url));
  }

  const sessionToken = await createUserSession(db, user.id, request.headers.get('user-agent'));

  const tripSessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  await linkCurrentTripSession(db, user.id, tripSessionToken);

  const response = NextResponse.redirect(new URL('/', request.url));
  return attachUserSessionCookie(response, sessionToken);
}
