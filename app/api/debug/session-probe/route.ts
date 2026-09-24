import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { resolveIdentity, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { resolveUser, USER_SESSION_COOKIE_NAME } from '@/lib/auth/user-session';

/**
 * ⚠️ 临时诊断端点（round48，排查"任意 trip 子路由快速连续导航后 session 丢失"），
 * 排查结束后应删除或至少确认不再需要——这不是长期功能。
 *
 * 目的：绕开 Next.js Router Cache/RSC 渲染层，直接从服务端当下的真实 cookie
 * 读一次 D1，回答"这一刻 tel_session/tel_user_session 到底有没有真的失效"，
 * 跟页面渲染出来的内容（可能是客户端缓存的旧渲染）互相印证，区分"cookie 真丢"
 * 还是"页面读到了旧状态"。
 *
 * 强制 dynamic + no-store：这个端点存在的唯一意义就是每次都打真实请求，
 * 不能被 fetch cache / router cache 短路，否则诊断信号本身就失真。
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(request: NextRequest) {
  const db = await getDb();
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const userToken = request.cookies.get(USER_SESSION_COOKIE_NAME)?.value;

  const [identity, user] = await Promise.all([
    resolveIdentity(db, sessionToken),
    resolveUser(db, userToken),
  ]);

  const payload = {
    ts: Date.now(),
    hasSessionCookie: !!sessionToken,
    hasUserCookie: !!userToken,
    identity: identity ? { tripId: identity.tripId, participantId: identity.participantId } : null,
    user: user ? { userId: user.userId } : null,
  };

  console.log('[diag-server] session-probe', JSON.stringify(payload));

  return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
}
