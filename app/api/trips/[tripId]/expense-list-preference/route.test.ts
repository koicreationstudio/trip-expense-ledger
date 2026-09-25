import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, type Db } from '@/lib/db/client';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';

/**
 * 第七十一轮任务⑥：活动流排序模式 + 4 个筛选条件云端同步，GET/PUT 这个路由是
 * 唯一读写口，照抄 `fx-compare-preference/route.test.ts` 的覆盖范围：①没存过档时
 * GET 返回 null ②PUT 存一份后 GET 能原样读回来 ③PUT 两次（upsert）第二次覆盖
 * 第一次，不产生第二行 ④不合法的 sortMode 值 400，不落库。
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
  return { tripId, ownerToken };
}

const SAMPLE_PREFERENCE = {
  sortMode: 'date',
  categoryFilter: '🍜 餐饮',
  payerFilter: 'Remy',
  dateFilter: '2026-09-15',
  paymentMethodFilter: '现金HKD',
};

describe('GET/PUT /api/trips/[tripId]/expense-list-preference', () => {
  it('没存过档时 GET 返回 preference:null，不报错', async () => {
    const { tripId, ownerToken } = await setupTripWithOwner('🇭🇰测试行程-列表偏好A');
    const res = await getHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expense-list-preference`, 'GET', ownerToken),
      { params: { tripId } }
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).preference).toBeNull();
  });

  it('PUT 存档后 GET 能原样读回来', async () => {
    const { tripId, ownerToken } = await setupTripWithOwner('🇭🇰测试行程-列表偏好B');
    const putRes = await putHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expense-list-preference`, 'PUT', ownerToken, SAMPLE_PREFERENCE),
      { params: { tripId } }
    );
    expect(putRes.status).toBe(200);

    const getRes = await getHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expense-list-preference`, 'GET', ownerToken),
      { params: { tripId } }
    );
    const body = (await getRes.json()) as any;
    expect(body.preference).toEqual(SAMPLE_PREFERENCE);
  });

  it('PUT 两次（upsert）：第二次覆盖第一次，不产生第二行', async () => {
    const { tripId, ownerToken } = await setupTripWithOwner('🇭🇰测试行程-列表偏好C');
    await putHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expense-list-preference`, 'PUT', ownerToken, SAMPLE_PREFERENCE),
      { params: { tripId } }
    );
    const second = { ...SAMPLE_PREFERENCE, sortMode: 'amount', categoryFilter: '✈️ 机票' };
    await putHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expense-list-preference`, 'PUT', ownerToken, second),
      { params: { tripId } }
    );

    const getRes = await getHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expense-list-preference`, 'GET', ownerToken),
      { params: { tripId } }
    );
    expect(((await getRes.json()) as any).preference).toEqual(second);

    const rows = await db.query.expenseListPreferences.findMany({
      where: (t, { eq }) => eq(t.tripId, tripId),
    });
    expect(rows.length).toBe(1);
  });

  it('不合法的 sortMode 值：400，不落库', async () => {
    const { tripId, ownerToken } = await setupTripWithOwner('🇭🇰测试行程-列表偏好D');
    const res = await putHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expense-list-preference`, 'PUT', ownerToken, {
        ...SAMPLE_PREFERENCE,
        sortMode: 'not-a-real-mode',
      }),
      { params: { tripId } }
    );
    expect(res.status).toBe(400);

    const rows = await db.query.expenseListPreferences.findMany({ where: (t, { eq }) => eq(t.tripId, tripId) });
    expect(rows.length).toBe(0);
  });
});
