import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, type Db } from '@/lib/db/client';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';
import { participants } from '@/lib/db/schema';

/**
 * payment_method 双轨归属的行为回归：有账号(userId)的支付方式要跨 trip/参与者
 * 可见，guest(没账号)的支付方式要老老实实锁在自己那个 participant 上。
 * 走真实 HTTP handler + 真实 miniflare D1（照抄
 * app/api/account/account-flow.test.ts 的建库方式），不直接单测
 * paymentMethodOwnerFilter 返回的 SQL 片段——那样测不出真正在意的行为：
 * 查询结果对不对，不是 SQL 长什么样。
 */

let db: Db;
let SESSION_COOKIE_NAME: string;
let USER_SESSION_COOKIE_NAME: string;
let createSession: typeof import('@/lib/auth/session').createSession;
let signupHandler: typeof import('@/app/api/account/signup/route').POST;
let tripsPostHandler: typeof import('@/app/api/trips/route').POST;
let paymentMethodsGetHandler: typeof import('@/app/api/payment-methods/route').GET;
let paymentMethodsPostHandler: typeof import('@/app/api/payment-methods/route').POST;

function jsonRequest(url: string, method: string, body?: unknown, cookies?: Record<string, string>) {
  const headers = new Headers({ 'content-type': 'application/json' });
  const cookieParts = Object.entries(cookies ?? {}).map(([k, v]) => `${k}=${v}`);
  if (cookieParts.length > 0) headers.set('cookie', cookieParts.join('; '));
  return new NextRequest(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

async function createTripAndGetSessionToken(userToken: string, tripName: string): Promise<string> {
  const res = await tripsPostHandler(
    jsonRequest('http://localhost/api/trips', 'POST', { name: tripName, baseCurrency: 'MYR', ownerDisplayName: 'Remy' }, {
      [USER_SESSION_COOKIE_NAME]: userToken,
    })
  );
  expect(res.status).toBe(201);
  const token = res.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) throw new Error('建行程没拿到 session token');
  return token;
}

function createPaymentMethodBody(label: string) {
  return { label, kind: 'card' as const, settlementCurrency: 'MYR' };
}

beforeAll(async () => {
  await setupTestDb();
  db = await getDb();

  ({ SESSION_COOKIE_NAME, createSession } = await import('@/lib/auth/session'));
  ({ USER_SESSION_COOKIE_NAME } = await import('@/lib/auth/user-session'));
  ({ POST: signupHandler } = await import('@/app/api/account/signup/route'));
  ({ POST: tripsPostHandler } = await import('@/app/api/trips/route'));
  ({ GET: paymentMethodsGetHandler, POST: paymentMethodsPostHandler } = await import('@/app/api/payment-methods/route'));
});

afterAll(async () => {
  await teardownTestDb();
});

describe('有账号的人：支付方式跨行程终身可见', () => {
  it('在 trip A 建的支付方式，切到同一账号的 trip B 依然查得到', async () => {
    const signupRes = await signupHandler(
      jsonRequest('http://localhost/api/account/signup', 'POST', {
        email: 'cross-trip@example.com',
        password: 'correct-horse-battery',
        displayName: 'Remy',
      })
    );
    const userToken = signupRes.cookies.get(USER_SESSION_COOKIE_NAME)?.value!;

    const tripATokenA = await createTripAndGetSessionToken(userToken, '曼谷');
    const tripBToken = await createTripAndGetSessionToken(userToken, '清迈');

    const createRes = await paymentMethodsPostHandler(
      jsonRequest('http://localhost/api/payment-methods', 'POST', createPaymentMethodBody('HSBC Visa'), {
        [SESSION_COOKIE_NAME]: tripATokenA,
      }),
      {}
    );
    expect(createRes.status).toBe(201);

    const listFromTripB = await paymentMethodsGetHandler(
      jsonRequest('http://localhost/api/payment-methods', 'GET', undefined, { [SESSION_COOKIE_NAME]: tripBToken }),
      {}
    );
    const body = (await listFromTripB.json()) as { paymentMethods: Array<{ label: string }> };
    expect(body.paymentMethods.map((m) => m.label)).toContain('HSBC Visa');
  });
});

describe('guest(没账号)：支付方式只在当趟行程内有效', () => {
  it('guest 建的支付方式，另一个完全无关的 trip/participant 查不到', async () => {
    // 造一趟有账号的 trip 拿到合法 tripId，再手动插一个没有 userId 的 guest
    // participant（模拟认领邀请链接、没注册账号的场景），直接用 createSession
    // 发一张 session token，跳过完整的邀请认领 HTTP 流程。
    const signupRes = await signupHandler(
      jsonRequest('http://localhost/api/account/signup', 'POST', {
        email: 'guest-owner@example.com',
        password: 'correct-horse-battery',
        displayName: 'Remy',
      })
    );
    const userToken = signupRes.cookies.get(USER_SESSION_COOKIE_NAME)?.value!;
    const tripRes = await tripsPostHandler(
      jsonRequest('http://localhost/api/trips', 'POST', { name: '新加坡', baseCurrency: 'MYR', ownerDisplayName: 'Remy' }, {
        [USER_SESSION_COOKIE_NAME]: userToken,
      })
    );
    const ownerToken = tripRes.cookies.get(SESSION_COOKIE_NAME)?.value!;
    const trip = (await tripRes.json()) as { trip: { id: string } };

    const guestId = crypto.randomUUID();
    await db.insert(participants).values({
      id: guestId,
      tripId: trip.trip.id,
      displayName: 'Htoo',
      isOwner: false,
      claimedAt: new Date(),
      userId: null,
    });
    const guestToken = await createSession(db, guestId, null);

    const createRes = await paymentMethodsPostHandler(
      jsonRequest('http://localhost/api/payment-methods', 'POST', createPaymentMethodBody('Guest 现金'), {
        [SESSION_COOKIE_NAME]: guestToken,
      }),
      {}
    );
    expect(createRes.status).toBe(201);

    // guest 自己能看到自己建的
    const guestOwnList = await paymentMethodsGetHandler(
      jsonRequest('http://localhost/api/payment-methods', 'GET', undefined, { [SESSION_COOKIE_NAME]: guestToken }),
      {}
    );
    const guestOwnBody = (await guestOwnList.json()) as { paymentMethods: Array<{ label: string }> };
    expect(guestOwnBody.paymentMethods.map((m) => m.label)).toContain('Guest 现金');

    // 同一趟行程的 owner（不同 participant，有账号）看不到 guest 的支付方式，
    // 也不该在自己的清单里看到——两者归属互不相干。
    const ownerList = await paymentMethodsGetHandler(
      jsonRequest('http://localhost/api/payment-methods', 'GET', undefined, { [SESSION_COOKIE_NAME]: ownerToken }),
      {}
    );
    const ownerBody = (await ownerList.json()) as { paymentMethods: Array<{ label: string }> };
    expect(ownerBody.paymentMethods.map((m) => m.label)).not.toContain('Guest 现金');
  });
});
