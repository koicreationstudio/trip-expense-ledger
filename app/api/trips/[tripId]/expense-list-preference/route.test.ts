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
  splitFilter: 'included',
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

  // 第七十二轮任务④：splitFilter 值域固定 3 档（'__all__'|'included'|'excluded'），
  // 跟其它 4 个动态候选筛选不一样，用精确 enum 校验，非法值要 400 且不落库。
  //
  // fix(2026-09-26 第七十二轮，ui-auditor 真机走查抓到真 bug 后补测)：这里原来写的
  // 是 `'ALL'`，跟 schemas.ts 当时的错误字面量一致，两边"互相印证"却都跟组件实际
  // 发出的 `expense-list.tsx` 哨兵常量 `'__all__'` 不一致，测试通过掩盖了真实的
  // 生产 400——这是"测试跟实现共享同一个错误假设，测不出真问题"的教训，改成
  // `'__all__'`，跟前端真实运行时发出的值对齐，不是随便挑一个能通过的字符串。
  it('splitFilter 传合法的三个值都能存住', async () => {
    for (const value of ['__all__', 'included', 'excluded'] as const) {
      const { tripId, ownerToken } = await setupTripWithOwner(`🇭🇰测试行程-分摊筛选-${value}`);
      const putRes = await putHandler(
        jsonRequest(`http://localhost/api/trips/${tripId}/expense-list-preference`, 'PUT', ownerToken, {
          ...SAMPLE_PREFERENCE,
          splitFilter: value,
        }),
        { params: { tripId } }
      );
      expect(putRes.status).toBe(200);
      const getRes = await getHandler(
        jsonRequest(`http://localhost/api/trips/${tripId}/expense-list-preference`, 'GET', ownerToken),
        { params: { tripId } }
      );
      expect(((await getRes.json()) as any).preference.splitFilter).toBe(value);
    }
  });

  it('splitFilter 传非法值（不在固定 3 档里）：400，不落库', async () => {
    const { tripId, ownerToken } = await setupTripWithOwner('🇭🇰测试行程-列表偏好E');
    const res = await putHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expense-list-preference`, 'PUT', ownerToken, {
        ...SAMPLE_PREFERENCE,
        splitFilter: 'not-a-real-value',
      }),
      { params: { tripId } }
    );
    expect(res.status).toBe(400);

    const rows = await db.query.expenseListPreferences.findMany({ where: (t, { eq }) => eq(t.tripId, tripId) });
    expect(rows.length).toBe(0);
  });
});
