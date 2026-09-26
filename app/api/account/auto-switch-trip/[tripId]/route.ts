import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { resolveUser, USER_SESSION_COOKIE_NAME } from '@/lib/auth/user-session';
import { createSession } from '@/lib/auth/session';
import { findParticipantForUserInTrip } from '@/lib/auth/find-participant-for-user';
import { attachSessionCookie } from '@/lib/http/session-cookie';

/**
 * round72 A组⑥①：根治"直接在地址栏输入某趟行程 URL，有时会被弹回上一次活跃
 * 的那趟行程"。
 *
 * 真根因（不是 race，是这套鉴权设计的结构性缺口）：`app/trips/[tripId]/layout.tsx`
 * 只认 Layer 1 tel_session（`identity.tripId`）跟 URL 里的 tripId 是否精确相等，
 * 一不相等就整个弹回首页——完全不检查这个人是不是透过 Layer 2 账号（`tel_user_session`）
 * 真的拥有/参与这趟目标行程。而首页看到 `identity` 还在，又会把人送回
 * `identity.tripId` 那趟"当前激活"的行程——两条逻辑叠在一起，效果就是：Remy
 * 名下有好几趟行程，只要她的 tel_session 当前碰巧指着别的行程，直接输任何其它
 * 行程的 URL 都会被弹回"当前那一趟"，不是随机的，是 100% 必然发生（取决于她当前
 * tel_session 指哪趟）。
 *
 * 修法：`TripLayout` 判定 mismatch 时，如果这个人有 Layer 2 账号，不直接
 * `redirect('/')`，而是先跳到这个 route——查这个账号在目标 tripId 下到底有没有
 * 合法的 participant（跟 `switch-trip/route.ts` 同一条查询，抽成
 * `findParticipantForUserInTrip` 共用），有就地铸一个新 tel_session 指向它、
 * 种上 cookie，再 303 跳回目标行程（这次 TripLayout 重新读到的 identity 就会
 * 匹配了）；查不到（真的无权限）才最终弹回首页。
 *
 * 用独立 route handler 而不是在 `TripLayout` 这个 server component 里直接改
 * cookie，是因为 Next.js App Router 不允许 server component 渲染期间写 cookie
 * （只有 route handler / server action / middleware 能写）。这个项目目前没有
 * `middleware.ts`，为了不额外引入一个新的运行时层（对 Cloudflare Workers 部署
 * 的兼容性没有必要的额外风险），选了"多绕一次 303"这个更保守的方案。
 */
export async function GET(request: NextRequest, { params }: { params: { tripId: string } }) {
  const { tripId } = params;
  const db = await getDb();
  const userToken = request.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
  const user = await resolveUser(db, userToken);

  // 303（不是默认的 307）跟 switch-trip/route.ts 那条原生表单分支同一套惯例：
  // 这是"操作完成后的结果重定向"，不是"资源永久搬到别处"，用 303 语义更准确，
  // 两条路由行为要一致，方便以后维护者对照。
  if (!user) {
    // 没有 Layer 2 账号（纯访客 tel_session，或者两个 cookie 都没有）——没有
    // "自动切换"这个能力的前提，维持原来的行为，弹回首页。
    return NextResponse.redirect(new URL('/', request.url), 303);
  }

  const participant = await findParticipantForUserInTrip(db, user.userId, tripId);
  if (!participant) {
    // 账号在这趟行程里真的没有合法身份（比如 URL 是瞎猜的/别人的行程）——
    // 不能自动切换，弹回首页，跟现有"越权一律当不存在"的原则一致。
    return NextResponse.redirect(new URL('/', request.url), 303);
  }

  const token = await createSession(db, participant.id, request.headers.get('user-agent'));
  const response = NextResponse.redirect(new URL(`/trips/${tripId}`, request.url), 303);
  return attachSessionCookie(response, token);
}
