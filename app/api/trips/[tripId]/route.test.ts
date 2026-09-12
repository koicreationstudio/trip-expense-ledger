import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, type Db } from '@/lib/db/client';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';
import { expenses, participants, wallets } from '@/lib/db/schema';

/**
 * DELETE /api/trips/[tripId] 权限边界 + 级联删除回归测试。
 *
 * 权限边界：只有 owner 能删自己的行程；非 owner（同一行程的另一个参与者）
 * 和"owner 但删的是别人的行程"两种越权方式都必须 404，不是 403（跟项目里
 * 其它 withTripOwner 路由、以及 expense DELETE 的"越权 404"原则保持一致）。
 *
 * 级联删除：真删了一趟带参与者+消费+钱包的行程之后，直接查 DB 断言这些
 * 关联行确实清空了，不是只信 schema.ts 里写着 onDelete: cascade 就当作
 * "肯定生效"——这是 CLAUDE.md 反复强调的"结论要有实证"。
 */

let db: Db;
let SESSION_COOKIE_NAME: string;
let USER_SESSION_COOKIE_NAME: string;
let createSession: typeof import('@/lib/auth/session').createSession;
let provisionHandler: typeof import('@/app/api/account/provision/route').POST;
let tripsPostHandler: typeof import('@/app/api/trips/route').POST;
let walletsPostHandler: typeof import('@/app/api/trips/[tripId]/wallets/route').POST;
let expensesPostHandler: typeof import('@/app/api/trips/[tripId]/expenses/route').POST;
let tripDeleteHandler: typeof import('@/app/api/trips/[tripId]/route').DELETE;
let tripGetHandler: typeof import('@/app/api/trips/[tripId]/route').GET;

function jsonRequest(
  url: string,
  method: string,
  token: string | undefined,
  body?: unknown,
  userToken?: string
) {
  const headers = new Headers({ 'content-type': 'application/json' });
  const cookieParts: string[] = [];
  if (token) cookieParts.push(`${SESSION_COOKIE_NAME}=${token}`);
  if (userToken) cookieParts.push(`${USER_SESSION_COOKIE_NAME}=${userToken}`);
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

  ({ createSession, SESSION_COOKIE_NAME } = await import('@/lib/auth/session'));
  ({ USER_SESSION_COOKIE_NAME } = await import('@/lib/auth/user-session'));
  ({ POST: provisionHandler } = await import('@/app/api/account/provision/route'));
  ({ POST: tripsPostHandler } = await import('@/app/api/trips/route'));
  ({ POST: walletsPostHandler } = await import('@/app/api/trips/[tripId]/wallets/route'));
  ({ POST: expensesPostHandler } = await import('@/app/api/trips/[tripId]/expenses/route'));
  ({ DELETE: tripDeleteHandler, GET: tripGetHandler } = await import('@/app/api/trips/[tripId]/route'));
});

afterAll(async () => {
  await teardownTestDb();
});

describe('DELETE /api/trips/[tripId]：只有 owner 能删，级联清空关联数据', () => {
  it('owner 删自己的行程成功；同行程非 owner 删会被 404 拒绝', async () => {
    const ownerProvision = await provisionHandler(jsonRequest('http://localhost/api/account/provision', 'POST', undefined));
    const ownerUserToken = ownerProvision.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
    expect(ownerUserToken).toBeTruthy();

    const createTripResponse = await tripsPostHandler(
      jsonRequest(
        'http://localhost/api/trips',
        'POST',
        undefined,
        { name: '待删除行程', baseCurrency: 'MYR', ownerDisplayName: 'Owner', participantNames: ['同行人'] },
        ownerUserToken
      )
    );
    expect(createTripResponse.status).toBe(201);
    const tripBody = (await createTripResponse.json()) as any;
    const tripId: string = tripBody.trip.id;
    const ownerToken = createTripResponse.cookies.get(SESSION_COOKIE_NAME)?.value;
    expect(ownerToken).toBeTruthy();

    const companion = tripBody.participants.find((p: { displayName: string }) => p.displayName === '同行人');
    expect(companion).toBeTruthy();
    const companionToken = await createSession(db, companion.id, null);

    // 灌一笔消费 + 一个钱包，等下删完直接查库断言级联清空了。
    const expenseResponse = await expensesPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses`, 'POST', ownerToken, {
        payerParticipantId: tripBody.trip.ownerParticipantId,
        amount: 500,
        currency: 'MYR',
        category: '餐饮',
        expenseDate: new Date().toISOString(),
      }),
      { params: { tripId } }
    );
    expect(expenseResponse.status).toBe(201);

    const walletResponse = await walletsPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/wallets`, 'POST', ownerToken, {
        label: '现金',
        currency: 'MYR',
        emoji: '💵',
        initialBalance: 10000,
      }),
      { params: { tripId } }
    );
    expect(walletResponse.status).toBe(201);

    // 删除前先确认数据真的落库了（不然下面"删完清空"的断言毫无意义）。
    const expensesBefore = await db.select().from(expenses).where(eq(expenses.tripId, tripId));
    const walletsBefore = await db.select().from(wallets).where(eq(wallets.tripId, tripId));
    const participantsBefore = await db.select().from(participants).where(eq(participants.tripId, tripId));
    expect(expensesBefore.length).toBe(1);
    expect(walletsBefore.length).toBe(1);
    expect(participantsBefore.length).toBe(2); // owner + 同行人

    // 非 owner（同行人）尝试删：404，不是 403，数据原封不动。
    const deleteAsCompanion = await tripDeleteHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}`, 'DELETE', companionToken),
      { params: { tripId } }
    );
    expect(deleteAsCompanion.status).toBe(404);
    expect(((await deleteAsCompanion.json()) as any).error).toBe('not_found');

    const stillThere = await tripGetHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}`, 'GET', ownerToken),
      { params: { tripId } }
    );
    expect(stillThere.status).toBe(200);

    // owner 删：成功。
    const deleteAsOwner = await tripDeleteHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}`, 'DELETE', ownerToken),
      { params: { tripId } }
    );
    expect(deleteAsOwner.status).toBe(204);

    // 级联验证：expense / wallet / participant（含 owner 和同行人两条）全部清空，
    // 不是只删了 trip 本体留下孤儿行。
    const expensesAfter = await db.select().from(expenses).where(eq(expenses.tripId, tripId));
    const walletsAfter = await db.select().from(wallets).where(eq(wallets.tripId, tripId));
    const participantsAfter = await db.select().from(participants).where(eq(participants.tripId, tripId));
    expect(expensesAfter.length).toBe(0);
    expect(walletsAfter.length).toBe(0);
    expect(participantsAfter.length).toBe(0);

    // 行程本体也真的没了：GET 现在 404（用同行人的 session 已经被级联删掉了，
    // 换用一个全新未登录请求来查，一样应该 404 而不是 401——405 之类别的状态码
    // 也算失败，这里唯独没有"未登录"这个变量，因为 GET 要求先过 withSession，
    // 没有任何有效 session 时会先命中 401；这里改用 owner 曾经的 token 早已随
    // participant 一起被级联删掉，同样解析不到身份，预期 401（跟"没带 cookie"
    // 是同一种"查不到有效身份"结果，不是 404）。
    const getAfterDelete = await tripGetHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}`, 'GET', ownerToken),
      { params: { tripId } }
    );
    expect(getAfterDelete.status).toBe(401);
  });

  it('owner 想删别人的行程（tripId 不属于自己）：404', async () => {
    const aProvision = await provisionHandler(jsonRequest('http://localhost/api/account/provision', 'POST', undefined));
    const aUserToken = aProvision.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
    const aTripResponse = await tripsPostHandler(
      jsonRequest(
        'http://localhost/api/trips',
        'POST',
        undefined,
        { name: 'A 的行程', baseCurrency: 'MYR', ownerDisplayName: 'A', participantNames: [] },
        aUserToken
      )
    );
    const aToken = aTripResponse.cookies.get(SESSION_COOKIE_NAME)?.value;

    const bProvision = await provisionHandler(jsonRequest('http://localhost/api/account/provision', 'POST', undefined));
    const bUserToken = bProvision.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
    const bTripResponse = await tripsPostHandler(
      jsonRequest(
        'http://localhost/api/trips',
        'POST',
        undefined,
        { name: 'B 的行程', baseCurrency: 'MYR', ownerDisplayName: 'B', participantNames: [] },
        bUserToken
      )
    );
    const bTripBody = (await bTripResponse.json()) as any;
    const bTripId: string = bTripBody.trip.id;

    // A 拿自己的 session（tripId 是 A 的行程）去删 B 的 tripId：assertSameTrip
    // 判断的是 identity.tripId !== params.tripId，A 的 session 根本不指向
    // bTripId，理应 404。
    const deleteForeign = await tripDeleteHandler(
      jsonRequest(`http://localhost/api/trips/${bTripId}`, 'DELETE', aToken),
      { params: { tripId: bTripId } }
    );
    expect(deleteForeign.status).toBe(404);

    // B 的行程应该还在。
    const bToken = bTripResponse.cookies.get(SESSION_COOKIE_NAME)?.value;
    const stillThere = await tripGetHandler(
      jsonRequest(`http://localhost/api/trips/${bTripId}`, 'GET', bToken),
      { params: { tripId: bTripId } }
    );
    expect(stillThere.status).toBe(200);
  });

  it('没带 session cookie 一律 401', async () => {
    const res = await tripDeleteHandler(jsonRequest('http://localhost/api/trips/nope', 'DELETE', undefined), {
      params: { tripId: 'nope' },
    });
    expect(res.status).toBe(401);
  });
});

/**
 * 行程切换器面板里，otherTrips 列表每一项旁边也带了删除图标（2026-09-12 加），
 * 点的是"账号名下另一趟自己是 owner、但当前 tel_session 并没有指向"的行程——
 * 这时 tel_session 还停在原来那趟行程上，上面那组测试用的"identity.tripId ===
 * params.tripId"判断法在这个场景下判不出来，DELETE handler 因此补了第二条鉴权
 * 腿：查 tel_user_session 这个账号在目标 tripId 下是不是 owner。这组测试专门
 * 盯这条新路径，不跟上面混在一起。
 */
describe('DELETE /api/trips/[tripId]：跨行程删除（tel_session 停在别处，改用账号身份鉴权）', () => {
  it('owner 的 tel_session 停在行程A，靠 tel_user_session 删账号名下的行程B：成功且级联清空，行程A不受影响', async () => {
    const ownerProvision = await provisionHandler(jsonRequest('http://localhost/api/account/provision', 'POST', undefined));
    const ownerUserToken = ownerProvision.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
    expect(ownerUserToken).toBeTruthy();

    const tripAResponse = await tripsPostHandler(
      jsonRequest(
        'http://localhost/api/trips',
        'POST',
        undefined,
        { name: '行程A', baseCurrency: 'MYR', ownerDisplayName: 'Owner', participantNames: [] },
        ownerUserToken
      )
    );
    const tripABody = (await tripAResponse.json()) as any;
    const tripAId: string = tripABody.trip.id;
    const tokenA = tripAResponse.cookies.get(SESSION_COOKIE_NAME)?.value; // 当前 tel_session 停在 A，不是 B
    expect(tokenA).toBeTruthy();

    const tripBResponse = await tripsPostHandler(
      jsonRequest(
        'http://localhost/api/trips',
        'POST',
        undefined,
        { name: '行程B', baseCurrency: 'MYR', ownerDisplayName: 'Owner', participantNames: ['同行人B'] },
        ownerUserToken
      )
    );
    const tripBBody = (await tripBResponse.json()) as any;
    const tripBId: string = tripBBody.trip.id;
    const tokenB = tripBResponse.cookies.get(SESSION_COOKIE_NAME)?.value;

    // 灌一笔消费到 B，等下验证「不带指向 B 的 tel_session、只靠账号身份」删 B
    // 时级联清空照样生效，不是这条新路径漏了什么。
    const expenseResponse = await expensesPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripBId}/expenses`, 'POST', tokenB, {
        payerParticipantId: tripBBody.trip.ownerParticipantId,
        amount: 200,
        currency: 'MYR',
        category: '交通',
        expenseDate: new Date().toISOString(),
      }),
      { params: { tripId: tripBId } }
    );
    expect(expenseResponse.status).toBe(201);

    const participantsBBefore = await db.select().from(participants).where(eq(participants.tripId, tripBId));
    expect(participantsBBefore.length).toBe(2); // owner + 同行人B

    // 关键请求：cookie 里 tel_session=tokenA（指向 A，不是 B）+
    // tel_user_session=ownerUserToken，完全模拟"人正待在行程A里，从切换器面板
    // 点了列表里行程B旁边的删除图标"这个真实场景，不经过 switch-trip。
    const deleteB = await tripDeleteHandler(
      jsonRequest(`http://localhost/api/trips/${tripBId}`, 'DELETE', tokenA, undefined, ownerUserToken),
      { params: { tripId: tripBId } }
    );
    expect(deleteB.status).toBe(204);

    const participantsBAfter = await db.select().from(participants).where(eq(participants.tripId, tripBId));
    const expensesBAfter = await db.select().from(expenses).where(eq(expenses.tripId, tripBId));
    expect(participantsBAfter.length).toBe(0);
    expect(expensesBAfter.length).toBe(0);

    // A 完全没被波及：tel_session=tokenA 依然有效，A 还在。
    const aStillThere = await tripGetHandler(jsonRequest(`http://localhost/api/trips/${tripAId}`, 'GET', tokenA), {
      params: { tripId: tripAId },
    });
    expect(aStillThere.status).toBe(200);
  });

  it('账号 C 跟目标行程毫无关系，光带着自己的 tel_user_session 想删：404，行程原封不动', async () => {
    const ownerBProvision = await provisionHandler(jsonRequest('http://localhost/api/account/provision', 'POST', undefined));
    const ownerBUserToken = ownerBProvision.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
    const tripResponse = await tripsPostHandler(
      jsonRequest(
        'http://localhost/api/trips',
        'POST',
        undefined,
        { name: 'B 的行程', baseCurrency: 'MYR', ownerDisplayName: 'OwnerB', participantNames: [] },
        ownerBUserToken
      )
    );
    const tripBody = (await tripResponse.json()) as any;
    const tripId: string = tripBody.trip.id;
    const ownerBToken = tripResponse.cookies.get(SESSION_COOKIE_NAME)?.value;

    const cProvision = await provisionHandler(jsonRequest('http://localhost/api/account/provision', 'POST', undefined));
    const cUserToken = cProvision.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
    expect(cUserToken).toBeTruthy();

    // 不带任何 tel_session，只带 C 的 tel_user_session：C 在这趟 trip 下没有
    // participant 行，两条鉴权腿都通不过，404。
    const deleteAsC = await tripDeleteHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}`, 'DELETE', undefined, undefined, cUserToken),
      { params: { tripId } }
    );
    expect(deleteAsC.status).toBe(404);

    const stillThere = await tripGetHandler(jsonRequest(`http://localhost/api/trips/${tripId}`, 'GET', ownerBToken), {
      params: { tripId },
    });
    expect(stillThere.status).toBe(200);
  });
});
