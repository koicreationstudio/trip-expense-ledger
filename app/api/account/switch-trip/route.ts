import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { participants } from '@/lib/db/schema';
import { resolveUser, USER_SESSION_COOKIE_NAME } from '@/lib/auth/user-session';
import { createSession } from '@/lib/auth/session';
import { attachSessionCookie } from '@/lib/http/session-cookie';
import { parseJsonBody } from '@/lib/http/validate';
import { switchTripSchema } from '@/lib/validation/schemas';

/**
 * 首页点一张"我的行程"卡片时打这个接口：拿 Layer 2 账号身份查「这个 user 在
 * 这个 trip 里对应哪个 participant」，查到了就用 Layer 1 现成的 createSession()
 * 给这个 participant 现铸一个新 tel_session，覆盖掉 cookie。
 *
 * 这是打通两层身份的关键点，也是这次新增的唯一一条跨 trip 权限边界：
 * 没有 userId 关联的 trip 一律 404（不是 403），跟现有"越权 404"原则一样严格。
 * 14 个现有 API 路由完全不用改，它们看到的永远是"当前激活的那一个 trip 的
 * tel_session"，只是这个 cookie 现在可以被这里按需重新指向不同的 trip。
 */
export async function POST(request: NextRequest) {
  const userToken = request.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
  const user = await resolveUser(db, userToken);
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = await parseJsonBody(request, switchTripSchema);
  if ('error' in parsed) return parsed.error;
  const { tripId } = parsed.data;

  const participant = await db.query.participants.findFirst({
    where: and(eq(participants.userId, user.userId), eq(participants.tripId, tripId)),
  });

  if (!participant) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const token = await createSession(db, participant.id, request.headers.get('user-agent'));

  const response = NextResponse.json({ ok: true, tripId });
  return attachSessionCookie(response, token);
}
