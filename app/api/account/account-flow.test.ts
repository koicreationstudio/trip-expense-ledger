import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Layer 2 账号系统的路由测试，照抄
 * app/api/trips/[tripId]/expenses/[expenseId]/route.test.ts 的写法：
 * 独立临时 SQLite 文件，DATABASE_PATH 在第一次 import lib/db/client 之前设好，
 * 所有牵到 db/client 的模块都用 beforeAll 里的动态 import。
 *
 * switch-trip 是这次新增的唯一一条跨 trip 权限边界：userId 没有关联到目标 trip
 * 的 participant，一律 404，测试要求跟现有"越权 404"原则一样严格。
 */

let tmpDbPath: string;

let db: typeof import('@/lib/db/client').db;
let SESSION_COOKIE_NAME: string;
let USER_SESSION_COOKIE_NAME: string;
let resolveIdentity: typeof import('@/lib/auth/session').resolveIdentity;
let signupHandler: typeof import('@/app/api/account/signup/route').POST;
let loginHandler: typeof import('@/app/api/account/login/route').POST;
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

beforeAll(async () => {
  tmpDbPath = path.join(os.tmpdir(), `tel-account-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  process.env.DATABASE_PATH = tmpDbPath;

  ({ db } = await import('@/lib/db/client'));
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  migrate(db, { migrationsFolder: './lib/db/migrations' });

  ({ SESSION_COOKIE_NAME, resolveIdentity } = await import('@/lib/auth/session'));
  ({ USER_SESSION_COOKIE_NAME } = await import('@/lib/auth/user-session'));
  ({ POST: signupHandler } = await import('@/app/api/account/signup/route'));
  ({ POST: loginHandler } = await import('@/app/api/account/login/route'));
  ({ POST: switchTripHandler } = await import('@/app/api/account/switch-trip/route'));
  ({ POST: tripsPostHandler } = await import('@/app/api/trips/route'));
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${tmpDbPath}${suffix}`, { force: true });
  }
});

describe('signup', () => {
  it('建号成功种 tel_user_session cookie，响应体不带 passwordHash', async () => {
    const res = await signupHandler(
      jsonRequest('http://localhost/api/account/signup', 'POST', {
        email: 'signup-ok@example.com',
        password: 'correct-horse-battery',
        displayName: 'Remy',
      })
    );
    expect(res.status).toBe(201);
    expect(res.cookies.get(USER_SESSION_COOKIE_NAME)?.value).toBeTruthy();

    const body = await res.json();
    expect(body.user.email).toBe('signup-ok@example.com');
    expect(body.user.displayName).toBe('Remy');
    expect(body.user.passwordHash).toBeUndefined();
  });

  it('重复邮箱拒绝（大小写/空格规范化后比对）', async () => {
    await signupHandler(
      jsonRequest('http://localhost/api/account/signup', 'POST', {
        email: 'dup@example.com',
        password: 'correct-horse-battery',
        displayName: 'A',
      })
    );

    const second = await signupHandler(
      jsonRequest('http://localhost/api/account/signup', 'POST', {
        email: '  Dup@Example.com  ',
        password: 'another-password',
        displayName: 'B',
      })
    );
    expect(second.status).toBe(409);
  });
});

describe('login', () => {
  it('密码错一律 401，找不到邮箱也一律 401（不区分两种情况）', async () => {
    await signupHandler(
      jsonRequest('http://localhost/api/account/signup', 'POST', {
        email: 'login-test@example.com',
        password: 'correct-horse-battery',
        displayName: 'C',
      })
    );

    const wrongPassword = await loginHandler(
      jsonRequest('http://localhost/api/account/login', 'POST', {
        email: 'login-test@example.com',
        password: 'wrong-password',
      })
    );
    expect(wrongPassword.status).toBe(401);
    const wrongPasswordBody = await wrongPassword.json();

    const unknownEmail = await loginHandler(
      jsonRequest('http://localhost/api/account/login', 'POST', {
        email: 'nobody-here@example.com',
        password: 'whatever',
      })
    );
    expect(unknownEmail.status).toBe(401);
    const unknownEmailBody = await unknownEmail.json();

    expect(unknownEmailBody.error).toBe(wrongPasswordBody.error);
  });

  it('密码对种下 tel_user_session cookie', async () => {
    const res = await loginHandler(
      jsonRequest('http://localhost/api/account/login', 'POST', {
        email: 'login-test@example.com',
        password: 'correct-horse-battery',
      })
    );
    expect(res.status).toBe(200);
    expect(res.cookies.get(USER_SESSION_COOKIE_NAME)?.value).toBeTruthy();
  });
});

describe('switch-trip：账号系统唯一新增的跨 trip 权限边界', () => {
  it('userId 关联的 trip 能切进去，没关联的 trip 一律 404（不是 403）', async () => {
    // U1 建 trip T1
    const u1Signup = await signupHandler(
      jsonRequest('http://localhost/api/account/signup', 'POST', {
        email: 'u1@example.com',
        password: 'correct-horse-battery',
        displayName: 'U1',
      })
    );
    const u1Token = u1Signup.cookies.get(USER_SESSION_COOKIE_NAME)?.value;

    const t1Response = await tripsPostHandler(
      jsonRequest(
        'http://localhost/api/trips',
        'POST',
        { name: 'T1', baseCurrency: 'MYR', ownerDisplayName: 'U1', participantNames: [] },
        { userToken: u1Token }
      )
    );
    expect(t1Response.status).toBe(201);
    const t1Id: string = (await t1Response.json()).trip.id;

    // U2 建 trip T2，跟 U1 完全无关
    const u2Signup = await signupHandler(
      jsonRequest('http://localhost/api/account/signup', 'POST', {
        email: 'u2@example.com',
        password: 'correct-horse-battery',
        displayName: 'U2',
      })
    );
    const u2Token = u2Signup.cookies.get(USER_SESSION_COOKIE_NAME)?.value;

    const t2Response = await tripsPostHandler(
      jsonRequest(
        'http://localhost/api/trips',
        'POST',
        { name: 'T2', baseCurrency: 'MYR', ownerDisplayName: 'U2', participantNames: [] },
        { userToken: u2Token }
      )
    );
    expect(t2Response.status).toBe(201);
    const t2Id: string = (await t2Response.json()).trip.id;

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
    expect((await switchToForeign.json()).error).toBe('not_found');
  });

  it('没有 tel_user_session 一律 401', async () => {
    const res = await switchTripHandler(
      jsonRequest('http://localhost/api/account/switch-trip', 'POST', { tripId: 'nope' })
    );
    expect(res.status).toBe(401);
  });
});
