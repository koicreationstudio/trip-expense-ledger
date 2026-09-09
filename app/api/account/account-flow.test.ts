import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/lib/db/client';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';
import { participants } from '@/lib/db/schema';

/**
 * Layer 2 账号系统的路由测试。2026-09-09 第十六轮登录系统换血：邮箱密码
 * signup/login 两条路由砍掉，改测 provision（首次自动开号）+ /id/[token]
 * （明文身份直连链接登录）这两条新路径。switch-trip 是账号系统唯一新增的
 * 跨 trip 权限边界，逻辑完全没变，只是"建账号"这一步的手段换成新流程。
 */

let db: Db;
let SESSION_COOKIE_NAME: string;
let USER_SESSION_COOKIE_NAME: string;
let resolveIdentity: typeof import('@/lib/auth/session').resolveIdentity;
let createSession: typeof import('@/lib/auth/session').createSession;
let provisionHandler: typeof import('@/app/api/account/provision/route').POST;
let identityLinkHandler: typeof import('@/app/id/[token]/route').GET;
let switchTripHandler: typeof import('@/app/api/account/switch-trip/route').POST;
let tripsPostHandler: typeof import('@/app/api/trips/route').POST;

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

function getRequest(url: string, cookies?: { token?: string; userToken?: string }) {
  const headers = new Headers();
  const cookieParts: string[] = [];
  if (cookies?.token) cookieParts.push(`${SESSION_COOKIE_NAME}=${cookies.token}`);
  if (cookies?.userToken) cookieParts.push(`${USER_SESSION_COOKIE_NAME}=${cookies.userToken}`);
  if (cookieParts.length > 0) headers.set('cookie', cookieParts.join('; '));
  return new NextRequest(url, { method: 'GET', headers });
}

beforeAll(async () => {
  await setupTestDb();
  db = await getDb();

  ({ SESSION_COOKIE_NAME, resolveIdentity, createSession } = await import('@/lib/auth/session'));
  ({ USER_SESSION_COOKIE_NAME } = await import('@/lib/auth/user-session'));
  ({ POST: provisionHandler } = await import('@/app/api/account/provision/route'));
  ({ GET: identityLinkHandler } = await import('@/app/id/[token]/route'));
  ({ POST: switchTripHandler } = await import('@/app/api/account/switch-trip/route'));
  ({ POST: tripsPostHandler } = await import('@/app/api/trips/route'));
});

afterAll(async () => {
  await teardownTestDb();
});

describe('provision：首次开号', () => {
  it('没有账号时开号成功，种下 tel_user_session cookie，返回明文身份链接', async () => {
    const res = await provisionHandler(jsonRequest('http://localhost/api/account/provision', 'POST'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.alreadyProvisioned).toBe(false);
    expect(body.identityUrl).toContain('/id/');
    expect(res.cookies.get(USER_SESSION_COOKIE_NAME)?.value).toBeTruthy();
  });

  it('已经有账号时幂等，不重复开号、不返回新链接', async () => {
    const first = await provisionHandler(jsonRequest('http://localhost/api/account/provision', 'POST'));
    const userToken = first.cookies.get(USER_SESSION_COOKIE_NAME)?.value;

    const second = await provisionHandler(
      jsonRequest('http://localhost/api/account/provision', 'POST', undefined, { userToken })
    );
    expect(second.status).toBe(200);
    const body = (await second.json()) as any;
    expect(body.alreadyProvisioned).toBe(true);
    expect(body.identityUrl).toBeUndefined();
  });
});

describe('身份直连链接 /id/[token]：邮箱密码登录砍掉后唯一的登录入口', () => {
  it('token 正确：种下新的 tel_user_session cookie，跳回首页', async () => {
    const provisionRes = await provisionHandler(jsonRequest('http://localhost/api/account/provision', 'POST'));
    const identityUrl: string = ((await provisionRes.json()) as any).identityUrl;
    const token = identityUrl.split('/id/')[1]!;

    const res = await identityLinkHandler(getRequest(`http://localhost/id/${token}`), {
      params: { token },
    });
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('location')).not.toContain('identity_invalid');
    expect(res.cookies.get(USER_SESSION_COOKIE_NAME)?.value).toBeTruthy();
  });

  it('token 错误：跳回首页带错误参数，不种 cookie', async () => {
    const res = await identityLinkHandler(getRequest('http://localhost/id/not-a-real-token'), {
      params: { token: 'not-a-real-token' },
    });
    expect(res.headers.get('location')).toContain('identity_invalid=1');
    expect(res.cookies.get(USER_SESSION_COOKIE_NAME)?.value).toBeFalsy();
  });

  it('带着活跃 tel_session 打开身份链接：顺手把这个 participant 关联到链接对应的账号（跟 link-current-trip 同一份共享逻辑）', async () => {
    // 建一个独立账号 + trip，只是用来产出一个真实 tripId，不直接用它的 owner participant。
    const ownerProvision = await provisionHandler(jsonRequest('http://localhost/api/account/provision', 'POST'));
    const ownerUserToken = ownerProvision.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
    const tripRes = await tripsPostHandler(
      jsonRequest(
        'http://localhost/api/trips',
        'POST',
        { name: 'Link Test Trip', baseCurrency: 'MYR', ownerDisplayName: 'Owner', participantNames: [] },
        { userToken: ownerUserToken }
      )
    );
    const tripBody = (await tripRes.json()) as any;

    // 手动建一个未绑账号的 participant，铸一个 tel_session 指向它——模拟
    // "游客刚认领完邀请，浏览器带着 tel_session，但还没关联任何账号"这个场景。
    const guestParticipantId = crypto.randomUUID();
    await db.insert(participants).values({
      id: guestParticipantId,
      tripId: tripBody.trip.id,
      displayName: 'Guest',
      isOwner: false,
      claimedAt: new Date(),
    });
    const guestSessionToken = await createSession(db, guestParticipantId, 'test-agent');

    // 这个游客现在去点开另一个全新账号的身份链接（比如自己之前在别的设备上
    // 建过号，这次换设备用身份链接登录）。
    const secondProvision = await provisionHandler(jsonRequest('http://localhost/api/account/provision', 'POST'));
    const secondIdentityUrl: string = ((await secondProvision.json()) as any).identityUrl;
    const secondToken = secondIdentityUrl.split('/id/')[1]!;

    const res = await identityLinkHandler(
      getRequest(`http://localhost/id/${secondToken}`, { token: guestSessionToken }),
      { params: { token: secondToken } }
    );
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);

    const updated = await db.query.participants.findFirst({ where: eq(participants.id, guestParticipantId) });
    expect(updated?.userId).toBeTruthy();
  });
});

describe('switch-trip：账号系统唯一新增的跨 trip 权限边界', () => {
  it('userId 关联的 trip 能切进去，没关联的 trip 一律 404（不是 403）', async () => {
    // U1 建 trip T1
    const u1Provision = await provisionHandler(jsonRequest('http://localhost/api/account/provision', 'POST'));
    const u1Token = u1Provision.cookies.get(USER_SESSION_COOKIE_NAME)?.value;

    const t1Response = await tripsPostHandler(
      jsonRequest(
        'http://localhost/api/trips',
        'POST',
        { name: 'T1', baseCurrency: 'MYR', ownerDisplayName: 'U1', participantNames: [] },
        { userToken: u1Token }
      )
    );
    expect(t1Response.status).toBe(201);
    const t1Id: string = ((await t1Response.json()) as any).trip.id;

    // U2 建 trip T2，跟 U1 完全无关
    const u2Provision = await provisionHandler(jsonRequest('http://localhost/api/account/provision', 'POST'));
    const u2Token = u2Provision.cookies.get(USER_SESSION_COOKIE_NAME)?.value;

    const t2Response = await tripsPostHandler(
      jsonRequest(
        'http://localhost/api/trips',
        'POST',
        { name: 'T2', baseCurrency: 'MYR', ownerDisplayName: 'U2', participantNames: [] },
        { userToken: u2Token }
      )
    );
    expect(t2Response.status).toBe(201);
    const t2Id: string = ((await t2Response.json()) as any).trip.id;

    // U1 切进自己的 T1：成功，拿到一个新的 tel_session 指向 T1
    const switchToOwn = await switchTripHandler(
      jsonRequest('http://localhost/api/account/switch-trip', 'POST', { tripId: t1Id }, { userToken: u1Token })
    );
    expect(switchToOwn.status).toBe(200);
    const newSessionToken = switchToOwn.cookies.get(SESSION_COOKIE_NAME)?.value;
    expect(newSessionToken).toBeTruthy();
    const identity = await resolveIdentity(db, newSessionToken);
    expect(identity?.tripId).toBe(t1Id);
    expect(identity?.isOwner).toBe(true);

    // U1 想切进 T2（自己完全没关联的行程）：一律 404，不是 403
    const switchToForeign = await switchTripHandler(
      jsonRequest('http://localhost/api/account/switch-trip', 'POST', { tripId: t2Id }, { userToken: u1Token })
    );
    expect(switchToForeign.status).toBe(404);
    expect(((await switchToForeign.json()) as any).error).toBe('not_found');
  });

  it('没有 tel_user_session 一律 401', async () => {
    const res = await switchTripHandler(
      jsonRequest('http://localhost/api/account/switch-trip', 'POST', { tripId: 'nope' })
    );
    expect(res.status).toBe(401);
  });
});
