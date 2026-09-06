import { NextRequest, NextResponse } from 'next/server';
import { db } from '../db/client';
import { resolveIdentity, SESSION_COOKIE_NAME } from './session';
import type { AuthenticatedIdentity } from './session';

export type RouteHandler<Context> = (
  request: NextRequest,
  context: Context,
  identity: AuthenticatedIdentity
) => Promise<NextResponse>;

/**
 * 包一层登录校验：查不到有效 session 一律 401，不区分"token 不存在"和"token 失效"，
 * 调用方拿到的 handler 里 identity 保证非 null。
 */
export function withSession<Context>(handler: RouteHandler<Context>) {
  return async (request: NextRequest, context: Context): Promise<NextResponse> => {
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    const identity = await resolveIdentity(db, token);

    if (!identity) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    return handler(request, context, identity);
  };
}

/**
 * 在 withSession 基础上再要求「必须是当前 trip 的 owner」，非 owner 一律 404，
 * 呼应 CLAUDE.md 的权限边界要求：不用 403 泄露"这个东西存在但你没权限"。
 * tripId 从 route context.params 里取，取不到（形状不对）视为编程错误直接抛。
 */
export function withTripOwner<Context extends { params: { tripId: string } }>(handler: RouteHandler<Context>) {
  return withSession<Context>(async (request, context, identity) => {
    if (identity.tripId !== context.params.tripId || !identity.isOwner) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return handler(request, context, identity);
  });
}

/** 校验当前身份属于 URL 里的这个 trip，不属于就当作资源不存在。 */
export function assertSameTrip(identity: AuthenticatedIdentity, tripId: string): NextResponse | null {
  if (identity.tripId !== tripId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return null;
}
