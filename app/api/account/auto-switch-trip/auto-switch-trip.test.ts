import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, type Db } from '@/lib/db/client';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';

/**
 * round72 A组⑥①：根治"直接输网址有时停在上一趟行程"的真根因——见
 * app/api/account/auto-switch-trip/[tripId]/route.ts 顶部注释的完整分析。
 * 这里只测这个 route handler 本体（有 Layer 2 账号 + 目标行程有 participant →
 * 自动种新 tel_session + 303 跳回目标行程；没有账号/账号在目标行程没有
 * participant → 303 回首页，不种 cookie）。
 *
 * TripLayout 里"判定 mismatch 时先查 getCurrentUser() 决定跳这里还是跳首页"
 * 那段分支逻辑是 Next.js server component（不是可以直接实例化调用的 route
 * handler），这个项目目前没有对 server component 做集成测试的工具链
 * （`route.test.ts` 这类都是直接 import+调用 route handler 函数），所以这一层
 * 分支本身没有自动化测试覆盖——这是这次任务如实要说明的测试缺口，不是假装
 * 测过。已通过人工读代码核对过这段分支逻辑（见 layout.tsx 的改动），只是没有
 * 自动化回归保护。
 */

let db: Db;
let SESSION_COOKIE_NAME: string;
let USER_SESSION_COOKIE_NAME: string;
let resolveIdentity: typeof import('@/lib/auth/session').resolveIdentity;
let provisionHandler: typeof import('@/app/api/account/provision/route').POST;
let tripsPostHandler: typeof import('@/app/api/trips/route').POST;
let autoSwitchHandler: typeof import('./[tripId]/route').GET;

function jsonRequest(url: string, method: string, body?: unknown, cookies?: { userToken?: string }) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (cookies?.userToken) headers.set('cookie', `${USER_SESSION_COOKIE_NAME}=${cookies.userToken}`);
  return new NextRequest(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

function autoSwitchRequest(tripId: string, userToken?: string) {
  const headers = new Headers();
  if (userToken) headers.set('cookie', `${USER_SESSION_COOKIE_NAME}=${userToken}`);
  return new NextRequest(`http://localhost/api/account/auto-switch-trip/${tripId}`, { method: 'GET', headers });
}

beforeAll(async () => {
  await setupTestDb();
  db = await getDb();
  ({ SESSION_COOKIE_NAME, resolveIdentity } = await import('@/lib/auth/session'));
  ({ USER_SESSION_COOKIE_NAME } = await import('@/lib/auth/user-session'));
  ({ POST: provisionHandler } = await import('@/app/api/account/provision/route'));
  ({ POST: tripsPostHandler } = await import('@/app/api/trips/route'));
  ({ GET: autoSwitchHandler } = await import('./[tripId]/route'));
});

afterAll(async () => {
  await teardownTestDb();
});

async function provisionUserWithTrip(name: string) {
  const provision = await provisionHandler(jsonRequest('http://localhost/api/account/provision', 'POST'));
  const userToken = provision.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
  const tripRes = await tripsPostHandler(
    jsonRequest(
      'http://localhost/api/trips',
      'POST',
      { name, baseCurrency: 'MYR', ownerDisplayName: name, participantNames: [] },
      { userToken }
    )
  );
  const tripId: string = ((await tripRes.json()) as any).trip.id;
  return { userToken, tripId };
}

describe('auto-switch-trip：直接输网址访问自己账号名下合法行程时自动铸新 tel_session', () => {
  it('账号在目标行程有 participant：自动种新 tel_session，303 跳回目标行程', async () => {
    const { userToken, tripId } = await provisionUserWithTrip('U-auto-own');

    const res = await autoSwitchHandler(autoSwitchRequest(tripId, userToken), { params: { tripId } });

    expect(res.status).toBe(303);
    expect(new URL(res.headers.get('location')!).pathname).toBe(`/trips/${tripId}`);
    const newToken = res.cookies.get(SESSION_COOKIE_NAME)?.value;
    expect(newToken).toBeTruthy();
    const identity = await resolveIdentity(db, newToken);
    expect(identity?.tripId).toBe(tripId);
  });

  it('账号在目标行程没有 participant（别人的行程）：303 回首页，不种 cookie', async () => {
    const { tripId: foreignTripId } = await provisionUserWithTrip('U-auto-owner-of-foreign-trip');
    const { userToken: myToken } = await provisionUserWithTrip('U-auto-outsider');

    const res = await autoSwitchHandler(autoSwitchRequest(foreignTripId, myToken), {
      params: { tripId: foreignTripId },
    });

    expect(res.status).toBe(303);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/');
    expect(res.cookies.get(SESSION_COOKIE_NAME)?.value).toBeFalsy();
  });

  it('没有 Layer 2 账号（没有 tel_user_session）：303 回首页，不种 cookie', async () => {
    const res = await autoSwitchHandler(autoSwitchRequest('some-trip-id'), { params: { tripId: 'some-trip-id' } });

    expect(res.status).toBe(303);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/');
    expect(res.cookies.get(SESSION_COOKIE_NAME)?.value).toBeFalsy();
  });
});
