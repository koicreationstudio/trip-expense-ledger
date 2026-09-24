import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
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
/**
 * 原生表单提交（2026-09-24 第六十四轮）：首页「我的行程」卡片外面包了一个
 * `<form method="post" action="/api/account/switch-trip">`，React 水合之前点卡片
 * 走的就是这条。跟 JSON 那条是同一套权限判断，区别只在回应方式：成功 303 跳进
 * 行程页（浏览器整页加载，拿到新 cookie），失败 303 回首页，不给裸 JSON 页面。
 * 跨站伪造：cookie 是 sameSite=lax，别的网站发来的 POST 不带 tel_user_session，
 * resolveUser 查不到人，直接回首页，不会替人切换行程。
 */
function isFormSubmission(request: NextRequest): boolean {
  const type = request.headers.get('content-type') ?? '';
  return type.startsWith('application/x-www-form-urlencoded') || type.startsWith('multipart/form-data');
}

export async function POST(request: NextRequest) {
  const db = await getDb();
  const fromForm = isFormSubmission(request);
  const userToken = request.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
  const user = await resolveUser(db, userToken);
  if (!user) {
    if (fromForm) return NextResponse.redirect(new URL('/', request.url), 303);
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let tripId: string;
  if (fromForm) {
    const form = await request.formData().catch(() => null);
    const parsed = switchTripSchema.safeParse({ tripId: form?.get('tripId') });
    if (!parsed.success) return NextResponse.redirect(new URL('/', request.url), 303);
    tripId = parsed.data.tripId;
  } else {
    const parsed = await parseJsonBody(request, switchTripSchema);
    if ('error' in parsed) return parsed.error;
    tripId = parsed.data.tripId;
  }

  const participant = await db.query.participants.findFirst({
    where: and(eq(participants.userId, user.userId), eq(participants.tripId, tripId)),
  });

  if (!participant) {
    if (fromForm) return NextResponse.redirect(new URL('/', request.url), 303);
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const token = await createSession(db, participant.id, request.headers.get('user-agent'));

  const response = fromForm
    ? NextResponse.redirect(new URL(`/trips/${tripId}`, request.url), 303)
    : NextResponse.json({ ok: true, tripId });
  return attachSessionCookie(response, token);
}
