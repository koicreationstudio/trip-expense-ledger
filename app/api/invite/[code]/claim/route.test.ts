import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/lib/db/client';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';
import { participants } from '@/lib/db/schema';

/**
 * 回归测试: 2026-09-08 ui-auditor 真机走查抓到的数据泄露 ——
 * 认领邀请链接时，如果请求恰好带着任何账号的 tel_user_session cookie（哪怕是
 * 完全不相关的另一个账号，或者创建者自己顺手点开预览），旧代码会把这个
 * participant 静默、永久绑定到那个账号的 userId 上，之后这个 participant
 * 的 payment_method 查询会读到该账号名下所有行程的支付方式。
 *
 * 正确行为：认领本身绝不碰 userId，账号关联只能通过用户登录/注册后显式调用
 * app/api/account/link-current-trip/route.ts 完成（该路由只认*当前请求自己
 * 的* tel_session 指向的 participant，不接受 ambient cookie 隐式生效）。
 *
 * 2026-09-09 第十六轮登录系统换血：建账号的手段从 signup 换成 provision
 * （首次自动开号），测试断言的核心行为完全没变。
 */

let db: Db;
let SESSION_COOKIE_NAME: string;
let USER_SESSION_COOKIE_NAME: string;
let provisionHandler: typeof import('@/app/api/account/provision/route').POST;
let tripsPostHandler: typeof import('@/app/api/trips/route').POST;
let invitesPostHandler: typeof import('@/app/api/trips/[tripId]/invites/route').POST;
let claimHandler: typeof import('./route').POST;
let resetClaimHandler: typeof import('@/app/api/trips/[tripId]/participants/[participantId]/reset-claim/route').POST;

function jsonRequest(
  url: string,
  method: string,
  body?: unknown,
  cookies?: { token?: string; userToken?: string }
) {
  const headers = new Headers({ 'content-type': 'application/json' });
  const cookieParts: string[] = [];
  if (cookies?.token) cookieParts.push(`${SESSION_COOKIE_NAME}=${cookies.token}`);
  if (cookies?.userToken) cookieParts.push(`${USER_SESSION_COOKIE_NAME}=${cookies.userToken}`);
  if (cookieParts.length > 0) headers.set('cookie', cookieParts.join('; '));
  return new NextRequest(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeAll(async () => {
  await setupTestDb();
  db = await getDb();

  ({ SESSION_COOKIE_NAME } = await import('@/lib/auth/session'));
  ({ USER_SESSION_COOKIE_NAME } = await import('@/lib/auth/user-session'));
  ({ POST: provisionHandler } = await import('@/app/api/account/provision/route'));
  ({ POST: tripsPostHandler } = await import('@/app/api/trips/route'));
  ({ POST: invitesPostHandler } = await import('@/app/api/trips/[tripId]/invites/route'));
  ({ POST: claimHandler } = await import('./route'));
  ({ POST: resetClaimHandler } = await import(
    '@/app/api/trips/[tripId]/participants/[participantId]/reset-claim/route'
  ));
});

afterAll(async () => {
  await teardownTestDb();
});

describe('邀请认领不该悄悄绑定 ambient 账号 cookie', () => {
  it('认领时浏览器带着别人的 tel_user_session，认领到的 participant 的 userId 必须保持 null', async () => {
    // Owner A 建行程 + 一个未认领占位 Wang
    const aProvision = await provisionHandler(jsonRequest('http://localhost/api/account/provision', 'POST'));
    const aUserToken = aProvision.cookies.get(USER_SESSION_COOKIE_NAME)?.value;

    const createTripResponse = await tripsPostHandler(
      jsonRequest(
        'http://localhost/api/trips',
        'POST',
        { name: '曼谷出差', baseCurrency: 'MYR', ownerDisplayName: 'A', participantNames: ['Wang'] },
        { userToken: aUserToken }
      )
    );
    expect(createTripResponse.status).toBe(201);
    const tripBody = (await createTripResponse.json()) as any;
    const tripId: string = tripBody.trip.id;
    const aToken = createTripResponse.cookies.get(SESSION_COOKIE_NAME)?.value;
    const wangParticipant = tripBody.participants.find((p: { displayName: string }) => p.displayName === 'Wang');
    expect(wangParticipant).toBeTruthy();

    const inviteResponse = await invitesPostHandler(
      jsonRequest('http://localhost/api/trips/x/invites', 'POST', {}, { token: aToken }),
      { params: { tripId } }
    );
    expect(inviteResponse.status).toBe(201);
    const inviteCode: string = ((await inviteResponse.json()) as any).code;

    // 跟 A 完全无关的另一个账号 B——模拟"浏览器恰好带着别的登录态"这个 ambient 场景
    const bProvision = await provisionHandler(jsonRequest('http://localhost/api/account/provision', 'POST'));
    const bUserToken = bProvision.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
    expect(bUserToken).toBeTruthy();

    // Wang 认领这个占位，但请求 cookie 里混着 B 的 tel_user_session
    const claimResponse = await claimHandler(
      jsonRequest(
        `http://localhost/api/invite/${inviteCode}/claim`,
        'POST',
        { participantId: wangParticipant.id },
        { userToken: bUserToken }
      ),
      { params: { code: inviteCode } }
    );
    expect(claimResponse.status).toBe(200);

    const row = await db.query.participants.findFirst({ where: eq(participants.id, wangParticipant.id) });
    expect(row?.userId).toBeNull();
  });
});

describe('reset-claim 必须连 userId 一起清掉', () => {
  it('reset 之后 claimedAt 和 userId 都变 null，不会让下一个认领的人继承旧账号的支付方式', async () => {
    const aProvision = await provisionHandler(jsonRequest('http://localhost/api/account/provision', 'POST'));
    const aUserToken = aProvision.cookies.get(USER_SESSION_COOKIE_NAME)?.value;

    const createTripResponse = await tripsPostHandler(
      jsonRequest(
        'http://localhost/api/trips',
        'POST',
        { name: '清迈出差', baseCurrency: 'MYR', ownerDisplayName: 'A', participantNames: ['Lee'] },
        { userToken: aUserToken }
      )
    );
    const tripBody = (await createTripResponse.json()) as any;
    const tripId: string = tripBody.trip.id;
    const aToken = createTripResponse.cookies.get(SESSION_COOKIE_NAME)?.value;
    const leeParticipant = tripBody.participants.find((p: { displayName: string }) => p.displayName === 'Lee');

    // 直接在库里模拟"这个 participant 之前已经通过合法的 link-current-trip 关联过账号"
    const ownerRow = await db.query.participants.findFirst({ where: eq(participants.id, tripBody.trip.ownerParticipantId) });
    await db.update(participants).set({ userId: ownerRow!.userId }).where(eq(participants.id, leeParticipant.id));

    const resetResponse = await resetClaimHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/participants/${leeParticipant.id}/reset-claim`, 'POST', undefined, {
        token: aToken,
      }),
      { params: { tripId, participantId: leeParticipant.id } }
    );
    expect(resetResponse.status).toBe(200);

    const row = await db.query.participants.findFirst({ where: eq(participants.id, leeParticipant.id) });
    expect(row?.claimedAt).toBeNull();
    expect(row?.userId).toBeNull();
  });
});
