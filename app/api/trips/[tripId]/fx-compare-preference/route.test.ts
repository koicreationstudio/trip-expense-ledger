import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, type Db } from '@/lib/db/client';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';

/**
 * 汇率比价卡片选项记忆化（2026-09-24，Remy 明确要求"按账号×行程记住，换设备
 * 也要能恢复"）—— GET/PUT 这个路由是唯一的读写口，覆盖：①没存过档时 GET
 * 返回 null，不报错 ②PUT 存一份后 GET 能原样读回来（模拟"同一浏览器刷新页面"）
 * ③PUT 两次（upsert）不会产生第二行，第二次的值覆盖第一次 ④不合法的持有/
 * 目标币种组合 400，不落库 ⑤两个不同的人（不同 owner）在同一趟行程下的偏好
 * 互不干扰。
 */

let db: Db;
let SESSION_COOKIE_NAME: string;
let USER_SESSION_COOKIE_NAME: string;
let provisionHandler: typeof import('@/app/api/account/provision/route').POST;
let tripsPostHandler: typeof import('@/app/api/trips/route').POST;
let getHandler: typeof import('./route').GET;
let putHandler: typeof import('./route').PUT;

function jsonRequest(url: string, method: string, token: string | undefined, body?: unknown, userToken?: string) {
  const headers = new Headers({ 'content-type': 'application/json' });
  const cookieParts: string[] = [];
  if (token) cookieParts.push(`${SESSION_COOKIE_NAME}=${token}`);
  if (userToken) cookieParts.push(`${USER_SESSION_COOKIE_NAME}=${userToken}`);
  if (cookieParts.length > 0) headers.set('cookie', cookieParts.join('; '));
  return new NextRequest(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

beforeAll(async () => {
  await setupTestDb();
  db = await getDb();

  ({ SESSION_COOKIE_NAME } = await import('@/lib/auth/session'));
  ({ USER_SESSION_COOKIE_NAME } = await import('@/lib/auth/user-session'));
  ({ POST: provisionHandler } = await import('@/app/api/account/provision/route'));
  ({ POST: tripsPostHandler } = await import('@/app/api/trips/route'));
  ({ GET: getHandler } = await import('./route'));
  ({ PUT: putHandler } = await import('./route'));
});

afterAll(async () => {
  await teardownTestDb();
});

async function setupTripWithOwner(name: string) {
  const provisionRes = await provisionHandler(jsonRequest('http://localhost/api/account/provision', 'POST', undefined));
  const userToken = provisionRes.cookies.get(USER_SESSION_COOKIE_NAME)?.value!;
  const createTripRes = await tripsPostHandler(
    jsonRequest('http://localhost/api/trips', 'POST', undefined, { name, baseCurrency: 'HKD', ownerDisplayName: 'Remy' }, userToken)
  );
  expect(createTripRes.status).toBe(201);
  const tripBody = (await createTripRes.json()) as any;
  const tripId: string = tripBody.trip.id;
  const ownerToken = createTripRes.cookies.get(SESSION_COOKIE_NAME)?.value!;
  return { tripId, ownerToken, userToken };
}

describe('GET/PUT /api/trips/[tripId]/fx-compare-preference', () => {
  it('没存过档时 GET 返回 preference:null，不报错', async () => {
    const { tripId, ownerToken } = await setupTripWithOwner('🇭🇰测试行程-偏好A');
    const res = await getHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/fx-compare-preference`, 'GET', ownerToken),
      { params: { tripId } }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.preference).toBeNull();
  });

  it('PUT 存档后 GET 能原样读回来（模拟同一浏览器刷新页面）', async () => {
    const { tripId, ownerToken } = await setupTripWithOwner('🇭🇰测试行程-偏好B');

    const putRes = await putHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/fx-compare-preference`, 'PUT', ownerToken, {
        holdCurrency: 'HKD',
        targetCurrency: 'USD',
        enabledCompareKeys: ['channel:wise', 'card:abc-123'],
        amountYuan: 1000,
      }),
      { params: { tripId } }
    );
    expect(putRes.status).toBe(200);

    const getRes = await getHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/fx-compare-preference`, 'GET', ownerToken),
      { params: { tripId } }
    );
    const body = (await getRes.json()) as any;
    expect(body.preference).toEqual({
      holdCurrency: 'HKD',
      targetCurrency: 'USD',
      enabledCompareKeys: ['channel:wise', 'card:abc-123'],
      amountYuan: 1000,
    });
  });

  it('PUT 两次是 upsert，不产生第二行，第二次的值覆盖第一次', async () => {
    const { tripId, ownerToken } = await setupTripWithOwner('🇭🇰测试行程-偏好C');

    await putHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/fx-compare-preference`, 'PUT', ownerToken, {
        holdCurrency: 'HKD',
        targetCurrency: 'USD',
        enabledCompareKeys: ['channel:wise'],
        amountYuan: 1000,
      }),
      { params: { tripId } }
    );
    await putHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/fx-compare-preference`, 'PUT', ownerToken, {
        holdCurrency: 'HKD',
        targetCurrency: 'CNY',
        enabledCompareKeys: ['channel:tng', 'card:xyz'],
        amountYuan: 2500,
      }),
      { params: { tripId } }
    );

    const getRes = await getHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/fx-compare-preference`, 'GET', ownerToken),
      { params: { tripId } }
    );
    const body = (await getRes.json()) as any;
    expect(body.preference.targetCurrency).toBe('CNY');
    expect(body.preference.amountYuan).toBe(2500);
    expect(body.preference.enabledCompareKeys).toEqual(['channel:tng', 'card:xyz']);

    const { fxComparePreferences } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    const rows = await db.select().from(fxComparePreferences).where(eq(fxComparePreferences.tripId, tripId));
    expect(rows.length).toBe(1); // upsert，不是每次 PUT 都插一行
  });

  it('不合法的持有/目标币种组合 400，不落库', async () => {
    const { tripId, ownerToken } = await setupTripWithOwner('🇭🇰测试行程-偏好D');

    const res = await putHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/fx-compare-preference`, 'PUT', ownerToken, {
        holdCurrency: 'JPY', // 不在候选池里
        targetCurrency: 'USD',
        enabledCompareKeys: [],
        amountYuan: 1000,
      }),
      { params: { tripId } }
    );
    expect(res.status).toBe(400);

    const getRes = await getHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/fx-compare-preference`, 'GET', ownerToken),
      { params: { tripId } }
    );
    const body = (await getRes.json()) as any;
    expect(body.preference).toBeNull();
  });

  it('两趟不同行程各自的偏好互不干扰（owner 各自只存自己那趟）', async () => {
    const tripA = await setupTripWithOwner('🇭🇰测试行程-偏好E1');
    const tripB = await setupTripWithOwner('🇭🇰测试行程-偏好E2');

    await putHandler(
      jsonRequest(`http://localhost/api/trips/${tripA.tripId}/fx-compare-preference`, 'PUT', tripA.ownerToken, {
        holdCurrency: 'HKD',
        targetCurrency: 'USD',
        enabledCompareKeys: ['channel:wise'],
        amountYuan: 111,
      }),
      { params: { tripId: tripA.tripId } }
    );
    await putHandler(
      jsonRequest(`http://localhost/api/trips/${tripB.tripId}/fx-compare-preference`, 'PUT', tripB.ownerToken, {
        holdCurrency: 'HKD',
        targetCurrency: 'CNY',
        enabledCompareKeys: ['channel:alipay'],
        amountYuan: 222,
      }),
      { params: { tripId: tripB.tripId } }
    );

    const resA = await getHandler(
      jsonRequest(`http://localhost/api/trips/${tripA.tripId}/fx-compare-preference`, 'GET', tripA.ownerToken),
      { params: { tripId: tripA.tripId } }
    );
    const resB = await getHandler(
      jsonRequest(`http://localhost/api/trips/${tripB.tripId}/fx-compare-preference`, 'GET', tripB.ownerToken),
      { params: { tripId: tripB.tripId } }
    );
    expect(((await resA.json()) as any).preference.amountYuan).toBe(111);
    expect(((await resB.json()) as any).preference.amountYuan).toBe(222);
  });

  it('跨行程访问别人的偏好返回 404（identity.tripId 跟 URL 里的 tripId 不一致）', async () => {
    const tripA = await setupTripWithOwner('🇭🇰测试行程-偏好F1');
    const tripB = await setupTripWithOwner('🇭🇰测试行程-偏好F2');

    const res = await getHandler(
      jsonRequest(`http://localhost/api/trips/${tripB.tripId}/fx-compare-preference`, 'GET', tripA.ownerToken),
      { params: { tripId: tripB.tripId } }
    );
    expect(res.status).toBe(404);
  });
});
