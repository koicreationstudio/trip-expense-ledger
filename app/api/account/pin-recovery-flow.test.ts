import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, type Db } from '@/lib/db/client';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';

/**
 * 密码/PIN 找回功能的路由测试（2026-09-23 第二次落地，round31 事故后 Remy
 * 本人在对话里重新确认才重做）。覆盖：设置/更新/清除 + 找回成功/失败/命中
 * 多个账号/限流。每个 describe 块用不同的 cf-connecting-ip 隔开限流桶，
 * 避免测试之间互相影响彼此的限流计数。
 */

let db: Db;
let USER_SESSION_COOKIE_NAME: string;
let provisionHandler: typeof import('@/app/api/account/provision/route').POST;
let setPinPost: typeof import('@/app/api/account/set-pin/route').POST;
let setPinDelete: typeof import('@/app/api/account/set-pin/route').DELETE;
let recoverPinHandler: typeof import('@/app/api/account/recover-pin/route').POST;
let resolveUser: typeof import('@/lib/auth/user-session').resolveUser;

function req(
  url: string,
  method: string,
  opts?: { body?: unknown; userToken?: string; ip?: string }
) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (opts?.userToken) headers.set('cookie', `${USER_SESSION_COOKIE_NAME}=${opts.userToken}`);
  if (opts?.ip) headers.set('cf-connecting-ip', opts.ip);
  return new NextRequest(url, {
    method,
    headers,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

async function provisionUser(ip: string) {
  const res = await provisionHandler(req('http://localhost/api/account/provision', 'POST', { ip }));
  const userToken = res.cookies.get(USER_SESSION_COOKIE_NAME)?.value!;
  const body = (await res.json()) as any;
  return { userToken, identityUrl: body.identityUrl as string };
}

beforeAll(async () => {
  await setupTestDb();
  db = await getDb();

  ({ USER_SESSION_COOKIE_NAME } = await import('@/lib/auth/user-session'));
  ({ resolveUser } = await import('@/lib/auth/user-session'));
  ({ POST: provisionHandler } = await import('@/app/api/account/provision/route'));
  ({ POST: setPinPost, DELETE: setPinDelete } = await import('@/app/api/account/set-pin/route'));
  ({ POST: recoverPinHandler } = await import('@/app/api/account/recover-pin/route'));
});

afterAll(async () => {
  await teardownTestDb();
});

describe('set-pin：登录态下设置/更新/清除', () => {
  it('未登录一律 401', async () => {
    const res = await setPinPost(req('http://localhost/api/account/set-pin', 'POST', { body: { pin: '1234' } }));
    expect(res.status).toBe(401);
  });

  it('太短的 PIN 拒绝', async () => {
    const { userToken } = await provisionUser('ip-setpin-1');
    const res = await setPinPost(
      req('http://localhost/api/account/set-pin', 'POST', { body: { pin: '12' }, userToken })
    );
    expect(res.status).toBe(400);
  });

  it('设置成功，可以再更新成新的', async () => {
    const { userToken } = await provisionUser('ip-setpin-2');
    const first = await setPinPost(
      req('http://localhost/api/account/set-pin', 'POST', { body: { pin: '1234' }, userToken })
    );
    expect(first.status).toBe(200);

    const second = await setPinPost(
      req('http://localhost/api/account/set-pin', 'POST', { body: { pin: '5678' }, userToken })
    );
    expect(second.status).toBe(200);
  });

  it('清除后未登录时清除接口一样 401', async () => {
    const res = await setPinDelete(req('http://localhost/api/account/set-pin', 'DELETE'));
    expect(res.status).toBe(401);
  });
});

describe('recover-pin：找回登录', () => {
  it('正确密码：拿到新的 tel_user_session cookie，能反查回原账号', async () => {
    const { userToken } = await provisionUser('ip-recover-1');
    const setRes = await setPinPost(
      req('http://localhost/api/account/set-pin', 'POST', { body: { pin: 'correct-pin-1' }, userToken })
    );
    expect(setRes.status).toBe(200);
    const originalUser = await resolveUser(db, userToken);

    const recoverRes = await recoverPinHandler(
      req('http://localhost/api/account/recover-pin', 'POST', {
        body: { pin: 'correct-pin-1' },
        ip: 'ip-recover-1',
      })
    );
    expect(recoverRes.status).toBe(200);
    const newToken = recoverRes.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
    expect(newToken).toBeTruthy();

    const recoveredUser = await resolveUser(db, newToken);
    expect(recoveredUser?.userId).toBe(originalUser?.userId);
  });

  it('错误密码：401，不种 cookie', async () => {
    const { userToken } = await provisionUser('ip-recover-2');
    await setPinPost(req('http://localhost/api/account/set-pin', 'POST', { body: { pin: 'correct-pin-2' }, userToken }));

    const res = await recoverPinHandler(
      req('http://localhost/api/account/recover-pin', 'POST', { body: { pin: 'wrong-pin' }, ip: 'ip-recover-2' })
    );
    expect(res.status).toBe(401);
    expect(res.cookies.get(USER_SESSION_COOKIE_NAME)?.value).toBeFalsy();
  });

  it('从没设过 PIN 的密码去找回：401（不会误判成某个账号）', async () => {
    const res = await recoverPinHandler(
      req('http://localhost/api/account/recover-pin', 'POST', {
        body: { pin: 'nobody-ever-set-this-pin' },
        ip: 'ip-recover-3',
      })
    );
    expect(res.status).toBe(401);
  });

  it('两个账号碰巧设了同一个密码：命中多个一律当没命中，不登进任何一个', async () => {
    const u1 = await provisionUser('ip-recover-4');
    const u2 = await provisionUser('ip-recover-4');
    await setPinPost(
      req('http://localhost/api/account/set-pin', 'POST', { body: { pin: 'shared-pin-1234' }, userToken: u1.userToken })
    );
    await setPinPost(
      req('http://localhost/api/account/set-pin', 'POST', { body: { pin: 'shared-pin-1234' }, userToken: u2.userToken })
    );

    const res = await recoverPinHandler(
      req('http://localhost/api/account/recover-pin', 'POST', {
        body: { pin: 'shared-pin-1234' },
        ip: 'ip-recover-4',
      })
    );
    expect(res.status).toBe(401);
    expect(res.cookies.get(USER_SESSION_COOKIE_NAME)?.value).toBeFalsy();
  });

  it('清除 PIN 之后用原密码找回：401', async () => {
    const { userToken } = await provisionUser('ip-recover-5');
    await setPinPost(req('http://localhost/api/account/set-pin', 'POST', { body: { pin: 'to-be-cleared' }, userToken }));
    await setPinDelete(req('http://localhost/api/account/set-pin', 'DELETE', { userToken }));

    const res = await recoverPinHandler(
      req('http://localhost/api/account/recover-pin', 'POST', { body: { pin: 'to-be-cleared' }, ip: 'ip-recover-5' })
    );
    expect(res.status).toBe(401);
  });

  it('同一个 IP 15 分钟内打满 10 次后，第 11 次直接 429（不再消耗一次真实比对）', async () => {
    const ip = 'ip-recover-ratelimit';
    for (let i = 0; i < 10; i++) {
      const res = await recoverPinHandler(
        req('http://localhost/api/account/recover-pin', 'POST', { body: { pin: 'irrelevant' }, ip })
      );
      expect(res.status).toBe(401);
    }
    const eleventh = await recoverPinHandler(
      req('http://localhost/api/account/recover-pin', 'POST', { body: { pin: 'irrelevant' }, ip })
    );
    expect(eleventh.status).toBe(429);
  });
});
