import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * 权限边界的核心回归测试：A 建了行程和一笔消费，B 是同一行程的另一个参与者，
 * B 用任何方式（含直接猜 expense id）都不能看到/改到 A 的消费明细，必须收到 404。
 * 这是 CLAUDE.md「API 权限边界」那节点名要求的自动化测试，不能只靠代码审查。
 *
 * 用独立临时 SQLite 文件跑，不碰 ./data/db.sqlite 这个开发用的真实数据库。
 * DATABASE_PATH 必须在第一次 import 到 lib/db/client 之前设好，所以这里全用
 * beforeAll 里的动态 import，不能在文件顶层静态 import 任何牵到 db/client 的模块。
 */

let tmpDbPath: string;

let db: typeof import('@/lib/db/client').db;
let createSession: typeof import('@/lib/auth/session').createSession;
let SESSION_COOKIE_NAME: string;
let USER_SESSION_COOKIE_NAME: string;
let signupHandler: typeof import('@/app/api/account/signup/route').POST;
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
  tmpDbPath = path.join(os.tmpdir(), `tel-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  process.env.DATABASE_PATH = tmpDbPath;

  ({ db } = await import('@/lib/db/client'));
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  migrate(db, { migrationsFolder: './lib/db/migrations' });

  ({ createSession, SESSION_COOKIE_NAME } = await import('@/lib/auth/session'));
  ({ USER_SESSION_COOKIE_NAME } = await import('@/lib/auth/user-session'));
  ({ POST: signupHandler } = await import('@/app/api/account/signup/route'));
  ({ POST: tripsPostHandler } = await import('@/app/api/trips/route'));
  ({ POST: expensesPostHandler } = await import('@/app/api/trips/[tripId]/expenses/route'));
  ({
    GET: expenseGetHandler,
    PATCH: expensePatchHandler,
    DELETE: expenseDeleteHandler,
  } = await import('@/app/api/trips/[tripId]/expenses/[expenseId]/route'));
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${tmpDbPath}${suffix}`, { force: true });
  }
});

describe('expense 权限边界：entered_by 之外一律 404', () => {
  it('B 看不到 A 录入的消费，A 自己能看，DELETE/PATCH 同样对 B 返回 404', async () => {
    // 建行程现在要求先登录（Layer 2 账号），先给 A 注册一个账号拿 tel_user_session。
    const signupResponse = await signupHandler(
      jsonRequest('http://localhost/api/account/signup', 'POST', undefined, {
        email: 'a-expense-boundary@example.com',
        password: 'correct-horse-battery',
        displayName: 'A',
      })
    );
    expect(signupResponse.status).toBe(201);
    const aUserToken = signupResponse.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
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
    const tripBody = await createTripResponse.json();
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
    const expenseId: string = (await createExpenseResponse.json()).expense.id;

    const asOwner = await expenseGetHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses/${expenseId}`, 'GET', aToken),
      { params: { tripId, expenseId } }
    );
    expect(asOwner.status).toBe(200);
    expect((await asOwner.json()).expense.id).toBe(expenseId);

    const asOther = await expenseGetHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses/${expenseId}`, 'GET', bToken),
      { params: { tripId, expenseId } }
    );
    expect(asOther.status).toBe(404);
    expect((await asOther.json()).error).toBe('not_found');

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
