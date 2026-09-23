import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/lib/db/client';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';
import { users } from '@/lib/db/schema';

let db: Db;
let USER_SESSION_COOKIE_NAME: string;
let provisionHandler: typeof import('@/app/api/account/provision/route').POST;
let setPinHandler: typeof import('@/app/api/account/set-pin/route').POST;
let recoverPinHandler: typeof import('@/app/api/account/recover-pin/route').POST;

function jsonRequest(url: string, method: string, body?: unknown, userToken?: string, extraHeaders?: HeadersInit) {
  const headers = new Headers({ 'content-type': 'application/json', ...extraHeaders });
  if (userToken) headers.set('cookie', `${USER_SESSION_COOKIE_NAME}=${userToken}`);
  return new NextRequest(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

beforeAll(async () => {
  await setupTestDb();
  db = await getDb();
  ({ USER_SESSION_COOKIE_NAME } = await import('@/lib/auth/user-session'));
  ({ POST: provisionHandler } = await import('@/app/api/account/provision/route'));
  ({ POST: setPinHandler } = await import('@/app/api/account/set-pin/route'));
  ({ POST: recoverPinHandler } = await import('@/app/api/account/recover-pin/route'));
});

afterAll(async () => {
  await teardownTestDb();
});

describe('set-pin：设置找回口令', () => {
  it('没登录（没有 tel_user_session）拒绝', async () => {
    const res = await setPinHandler(
      jsonRequest('http://localhost/api/account/set-pin', 'POST', { pin: 'longEnoughPin1' })
    );
    expect(res.status).toBe(401);
  });

  it('太短的密码拒绝', async () => {
    const provisionRes = await provisionHandler(jsonRequest('http://localhost/api/account/provision', 'POST'));
    const userToken = provisionRes.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
    const res = await setPinHandler(
      jsonRequest('http://localhost/api/account/set-pin', 'POST', { pin: '123' }, userToken)
    );
    expect(res.status).toBe(400);
  });

  it('设置成功后数据库里存的是哈希，不是明文', async () => {
    const provisionRes = await provisionHandler(jsonRequest('http://localhost/api/account/provision', 'POST'));
    const userToken = provisionRes.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
    const { identityUrl } = (await provisionRes.json()) as { identityUrl: string };
    const identityToken = identityUrl.split('/id/')[1]!;

    const res = await setPinHandler(
      jsonRequest('http://localhost/api/account/set-pin', 'POST', { pin: 'my-real-password' }, userToken)
    );
    expect(res.status).toBe(200);

    const row = await db.query.users.findFirst({ where: eq(users.identityToken, identityToken) });
    expect(row?.recoveryPinHash).toBeTruthy();
    expect(row?.recoveryPinHash).not.toContain('my-real-password');
    expect(row?.recoveryPinSetAt).toBeTruthy();
  });
});

describe('recover-pin：用密码/PIN 找回账号（cookie 丢了场景）', () => {
  it('正确密码：拿到新的 tel_user_session，能重新进账号', async () => {
    const provisionRes = await provisionHandler(jsonRequest('http://localhost/api/account/provision', 'POST'));
    const userToken = provisionRes.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
    await setPinHandler(
      jsonRequest('http://localhost/api/account/set-pin', 'POST', { pin: 'recover-me-please' }, userToken)
    );

    const res = await recoverPinHandler(
      jsonRequest('http://localhost/api/account/recover-pin', 'POST', { pin: 'recover-me-please' })
    );
    expect(res.status).toBe(200);
    expect(res.cookies.get(USER_SESSION_COOKIE_NAME)?.value).toBeTruthy();
  });

  it('错误密码：拒绝，不种 cookie', async () => {
    const provisionRes = await provisionHandler(jsonRequest('http://localhost/api/account/provision', 'POST'));
    const userToken = provisionRes.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
    await setPinHandler(
      jsonRequest('http://localhost/api/account/set-pin', 'POST', { pin: 'the-real-password' }, userToken)
    );

    const res = await recoverPinHandler(
      jsonRequest('http://localhost/api/account/recover-pin', 'POST', { pin: 'totally-wrong-guess' })
    );
    expect(res.status).toBe(401);
    expect(res.cookies.get(USER_SESSION_COOKIE_NAME)?.value).toBeFalsy();
  });

  it('从没设置过找回口令的账号：任何密码都找不到匹配，拒绝', async () => {
    const res = await recoverPinHandler(
      jsonRequest('http://localhost/api/account/recover-pin', 'POST', { pin: 'nobody-set-this-pin' })
    );
    expect(res.status).toBe(401);
  });

  it('限流：同一来源短时间内连续猜错次数超阈值，即使后面密码猜对了也拒绝', async () => {
    const provisionRes = await provisionHandler(jsonRequest('http://localhost/api/account/provision', 'POST'));
    const userToken = provisionRes.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
    await setPinHandler(
      jsonRequest('http://localhost/api/account/set-pin', 'POST', { pin: 'rate-limit-target' }, userToken)
    );

    const ip = { 'cf-connecting-ip': '203.0.113.9' };
    for (let i = 0; i < 10; i++) {
      await recoverPinHandler(
        jsonRequest('http://localhost/api/account/recover-pin', 'POST', { pin: `wrong-guess-${i}` }, undefined, ip)
      );
    }

    const res = await recoverPinHandler(
      jsonRequest('http://localhost/api/account/recover-pin', 'POST', { pin: 'rate-limit-target' }, undefined, ip)
    );
    expect(res.status).toBe(429);
  });
});
