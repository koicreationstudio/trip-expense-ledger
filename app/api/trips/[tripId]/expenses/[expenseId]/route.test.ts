import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, type Db } from '@/lib/db/client';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';

/**
 * 权限边界的核心回归测试：A 建了行程和一笔消费，B 是同一行程的另一个参与者，
 * B 用任何方式（含直接猜 expense id）都不能看到/改到 A 的消费明细，必须收到 404。
 * 这是 CLAUDE.md「API 权限边界」那节点名要求的自动化测试，不能只靠代码审查。
 *
 * 用 getPlatformProxy() 换一套独立的本地 miniflare D1 binding（persist: false，
 * 全新空库），不碰任何真实数据库，迁移在 beforeAll 里跑一次。
 */

let db: Db;
let createSession: typeof import('@/lib/auth/session').createSession;
let SESSION_COOKIE_NAME: string;
let USER_SESSION_COOKIE_NAME: string;
let provisionHandler: typeof import('@/app/api/account/provision/route').POST;
let tripsPostHandler: typeof import('@/app/api/trips/route').POST;
let expensesPostHandler: typeof import('@/app/api/trips/[tripId]/expenses/route').POST;
let expenseGetHandler: typeof import('@/app/api/trips/[tripId]/expenses/[expenseId]/route').GET;
let expensePatchHandler: typeof import('@/app/api/trips/[tripId]/expenses/[expenseId]/route').PATCH;
let expenseDeleteHandler: typeof import('@/app/api/trips/[tripId]/expenses/[expenseId]/route').DELETE;

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
  ({ POST: expensesPostHandler } = await import('@/app/api/trips/[tripId]/expenses/route'));
  ({
    GET: expenseGetHandler,
    PATCH: expensePatchHandler,
    DELETE: expenseDeleteHandler,
  } = await import('@/app/api/trips/[tripId]/expenses/[expenseId]/route'));
});

afterAll(async () => {
  await teardownTestDb();
});

describe('expense 权限边界：entered_by 之外一律 404', () => {
  it('B 看不到 A 录入的消费，A 自己能看，DELETE/PATCH 同样对 B 返回 404', async () => {
    // 建行程现在要求先有账号（Layer 2），先给 A 开号拿 tel_user_session
    // （2026-09-09 第十六轮登录换血：signup 换成 provision，行为等价）。
    const provisionResponse = await provisionHandler(
      jsonRequest('http://localhost/api/account/provision', 'POST', undefined)
    );
    expect(provisionResponse.status).toBe(200);
    const aUserToken = provisionResponse.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
    expect(aUserToken).toBeTruthy();

    const createTripResponse = await tripsPostHandler(
      jsonRequest(
        'http://localhost/api/trips',
        'POST',
        undefined,
        {
          name: '东京出差',
          baseCurrency: 'MYR',
          ownerDisplayName: 'A',
          participantNames: ['B'],
        },
        aUserToken
      )
    );
    expect(createTripResponse.status).toBe(201);
    const tripBody = (await createTripResponse.json()) as any;
    const tripId: string = tripBody.trip.id;
    const aToken = createTripResponse.cookies.get(SESSION_COOKIE_NAME)?.value;
    expect(aToken).toBeTruthy();

    const bParticipant = tripBody.participants.find((p: { displayName: string }) => p.displayName === 'B');
    expect(bParticipant).toBeTruthy();
    const bToken = await createSession(db, bParticipant.id, null);

    const createExpenseResponse = await expensesPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses`, 'POST', aToken, {
        payerParticipantId: tripBody.trip.ownerParticipantId,
        amount: 300,
        currency: 'MYR',
        category: '餐饮',
        expenseDate: new Date().toISOString(),
      }),
      { params: { tripId } }
    );
    expect(createExpenseResponse.status).toBe(201);
    const expenseId: string = ((await createExpenseResponse.json()) as any).expense.id;

    const asOwner = await expenseGetHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses/${expenseId}`, 'GET', aToken),
      { params: { tripId, expenseId } }
    );
    expect(asOwner.status).toBe(200);
    expect(((await asOwner.json()) as any).expense.id).toBe(expenseId);

    const asOther = await expenseGetHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses/${expenseId}`, 'GET', bToken),
      { params: { tripId, expenseId } }
    );
    expect(asOther.status).toBe(404);
    expect(((await asOther.json()) as any).error).toBe('not_found');

    const patchAsOther = await expensePatchHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses/${expenseId}`, 'PATCH', bToken, {
        note: '想改别人的消费',
      }),
      { params: { tripId, expenseId } }
    );
    expect(patchAsOther.status).toBe(404);

    const deleteAsOther = await expenseDeleteHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses/${expenseId}`, 'DELETE', bToken),
      { params: { tripId, expenseId } }
    );
    expect(deleteAsOther.status).toBe(404);

    const deleteAsOwner = await expenseDeleteHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses/${expenseId}`, 'DELETE', aToken),
      { params: { tripId, expenseId } }
    );
    expect(deleteAsOwner.status).toBe(204);
  });

  it('没带 session cookie 一律 401，不是 404 也不是放行', async () => {
    const response = await expenseGetHandler(
      jsonRequest('http://localhost/api/trips/nope/expenses/nope', 'GET', undefined),
      { params: { tripId: 'nope', expenseId: 'nope' } }
    );
    expect(response.status).toBe(401);
  });
});
