import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, type Db } from '@/lib/db/client';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';

/**
 * 换汇记录删除：核心要验两件事——①权限边界（别人的记录一律 404，跟 expense/
 * wallet 同一条规矩）②余额回滚数字算对（这才是这个端点存在的意义，光删记录
 * 不回滚余额会让钱包数字跟历史记录脱节，见 route.ts 顶部大段注释）。
 */

let db: Db;
let SESSION_COOKIE_NAME: string;
let USER_SESSION_COOKIE_NAME: string;
let provisionHandler: typeof import('@/app/api/account/provision/route').POST;
let tripsPostHandler: typeof import('@/app/api/trips/route').POST;
let walletsPostHandler: typeof import('@/app/api/trips/[tripId]/wallets/route').POST;
let walletsGetHandler: typeof import('@/app/api/trips/[tripId]/wallets/route').GET;
let exchangePostHandler: typeof import('@/app/api/trips/[tripId]/exchange-records/route').POST;
let exchangeDeleteHandler: typeof import('@/app/api/trips/[tripId]/exchange-records/[exchangeRecordId]/route').DELETE;
let createSession: typeof import('@/lib/auth/session').createSession;

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

  ({ createSession, SESSION_COOKIE_NAME } = await import('@/lib/auth/session'));
  ({ USER_SESSION_COOKIE_NAME } = await import('@/lib/auth/user-session'));
  ({ POST: provisionHandler } = await import('@/app/api/account/provision/route'));
  ({ POST: tripsPostHandler } = await import('@/app/api/trips/route'));
  ({ POST: walletsPostHandler, GET: walletsGetHandler } = await import('@/app/api/trips/[tripId]/wallets/route'));
  ({ POST: exchangePostHandler } = await import('@/app/api/trips/[tripId]/exchange-records/route'));
  ({ DELETE: exchangeDeleteHandler } = await import(
    '@/app/api/trips/[tripId]/exchange-records/[exchangeRecordId]/route'
  ));
});

afterAll(async () => {
  await teardownTestDb();
});

async function setupTripWithOwnerAndOther() {
  const provisionResponse = await provisionHandler(
    jsonRequest('http://localhost/api/account/provision', 'POST', undefined)
  );
  const aUserToken = provisionResponse.cookies.get(USER_SESSION_COOKIE_NAME)?.value;

  const createTripResponse = await tripsPostHandler(
    jsonRequest(
      'http://localhost/api/trips',
      'POST',
      undefined,
      { name: '香港', baseCurrency: 'HKD', ownerDisplayName: 'A', participantNames: ['B'] },
      aUserToken
    )
  );
  const tripBody = (await createTripResponse.json()) as any;
  const tripId: string = tripBody.trip.id;
  const aToken = createTripResponse.cookies.get(SESSION_COOKIE_NAME)?.value as string;
  const bParticipant = tripBody.participants.find((p: { displayName: string }) => p.displayName === 'B');
  const bToken = await createSession(db, bParticipant.id, null);

  return { tripId, aToken, bToken };
}

async function createWallet(tripId: string, token: string, label: string, currency: string) {
  const res = await walletsPostHandler(
    jsonRequest(`http://localhost/api/trips/${tripId}/wallets`, 'POST', token, {
      label,
      currency,
      emoji: '💵',
    }),
    { params: { tripId } }
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as any).wallet.id as string;
}

async function getWalletBalance(tripId: string, token: string, walletId: string) {
  const res = await walletsGetHandler(jsonRequest(`http://localhost/api/trips/${tripId}/wallets`, 'GET', token), {
    params: { tripId },
  });
  const body = (await res.json()) as any;
  return body.wallets.find((w: any) => w.id === walletId).currentBalance as number;
}

describe('换汇记录删除', () => {
  it('删除后双边钱包余额精确回滚到删除前的数字，记录本身也真的没了', async () => {
    const { tripId, aToken } = await setupTripWithOwnerAndOther();
    const walletA = await createWallet(tripId, aToken, '钱包A(MYR)', 'MYR');
    const walletB = await createWallet(tripId, aToken, '钱包B(HKD)', 'HKD');

    // 拿 100 MYR 换成 160 HKD：A -10000 分，B +16000 分。
    const createRes = await exchangePostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/exchange-records`, 'POST', aToken, {
        fromWalletId: walletA,
        toWalletId: walletB,
        fromAmount: 10000,
        toAmount: 16000,
        exchangeDate: new Date().toISOString(),
      }),
      { params: { tripId } }
    );
    expect(createRes.status).toBe(201);
    const recordId: string = ((await createRes.json()) as any).exchangeRecord.id;

    expect(await getWalletBalance(tripId, aToken, walletA)).toBe(-10000);
    expect(await getWalletBalance(tripId, aToken, walletB)).toBe(16000);

    const deleteRes = await exchangeDeleteHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/exchange-records/${recordId}`, 'DELETE', aToken),
      { params: { tripId, exchangeRecordId: recordId } }
    );
    expect(deleteRes.status).toBe(204);

    // 回滚到删除前的数字：两个钱包都精确回到 0，不是"归零"式的粗暴重置，是反向
    // 加减算出来的，跟其它换汇/消费操作互不干扰这一点靠下面这条 case 另外验证。
    expect(await getWalletBalance(tripId, aToken, walletA)).toBe(0);
    expect(await getWalletBalance(tripId, aToken, walletB)).toBe(0);

    const redeleteRes = await exchangeDeleteHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/exchange-records/${recordId}`, 'DELETE', aToken),
      { params: { tripId, exchangeRecordId: recordId } }
    );
    expect(redeleteRes.status).toBe(404);
  });

  it('删除中间一笔不影响同一钱包上其它独立换汇记录各自的净影响（互相独立，不级联重算）', async () => {
    const { tripId, aToken } = await setupTripWithOwnerAndOther();
    const walletA = await createWallet(tripId, aToken, '钱包A', 'MYR');
    const walletB = await createWallet(tripId, aToken, '钱包B', 'HKD');

    // 三笔独立换汇：都是 A→B，各自金额不同。
    async function exchange(fromAmount: number, toAmount: number) {
      const res = await exchangePostHandler(
        jsonRequest(`http://localhost/api/trips/${tripId}/exchange-records`, 'POST', aToken, {
          fromWalletId: walletA,
          toWalletId: walletB,
          fromAmount,
          toAmount,
          exchangeDate: new Date().toISOString(),
        }),
        { params: { tripId } }
      );
      return ((await res.json()) as any).exchangeRecord.id as string;
    }

    const r1 = await exchange(1000, 1600); // A-1000 B+1600
    await exchange(2000, 3200); // A-2000 B+3200 (r2，故意不删)
    await exchange(3000, 4800); // A-3000 B+4800 (r3，故意不删)

    // 三笔叠加后：A = -6000，B = +9600
    expect(await getWalletBalance(tripId, aToken, walletA)).toBe(-6000);
    expect(await getWalletBalance(tripId, aToken, walletB)).toBe(9600);

    // 删掉最早那笔（r1），只应该精确撤销 r1 自己的净影响：A 回加 1000，B 回减 1600。
    const deleteRes = await exchangeDeleteHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/exchange-records/${r1}`, 'DELETE', aToken),
      { params: { tripId, exchangeRecordId: r1 } }
    );
    expect(deleteRes.status).toBe(204);

    // 剩下 r2+r3 的净影响原封不动：A = -6000+1000 = -5000，B = 9600-1600 = 8000，
    // 正好等于只算 r2+r3 两笔（-2000-3000=-5000，3200+4800=8000）——证明删中间一笔
    // 不会波及其它笔，不需要、也没有去"级联重算"。
    expect(await getWalletBalance(tripId, aToken, walletA)).toBe(-5000);
    expect(await getWalletBalance(tripId, aToken, walletB)).toBe(8000);
  });

  it('B 删不了 A 的换汇记录，返回 404 而不是放行或改动余额', async () => {
    const { tripId, aToken, bToken } = await setupTripWithOwnerAndOther();
    const walletA = await createWallet(tripId, aToken, '钱包A', 'MYR');
    const walletB = await createWallet(tripId, aToken, '钱包B', 'HKD');

    const createRes = await exchangePostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/exchange-records`, 'POST', aToken, {
        fromWalletId: walletA,
        toWalletId: walletB,
        fromAmount: 500,
        toAmount: 800,
        exchangeDate: new Date().toISOString(),
      }),
      { params: { tripId } }
    );
    const recordId: string = ((await createRes.json()) as any).exchangeRecord.id;

    const deleteAsOther = await exchangeDeleteHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/exchange-records/${recordId}`, 'DELETE', bToken),
      { params: { tripId, exchangeRecordId: recordId } }
    );
    expect(deleteAsOther.status).toBe(404);
    // 余额没被 B 的失败请求动到分毫。
    expect(await getWalletBalance(tripId, aToken, walletA)).toBe(-500);
    expect(await getWalletBalance(tripId, aToken, walletB)).toBe(800);
  });

  it('没带 session cookie 一律 401', async () => {
    const response = await exchangeDeleteHandler(
      jsonRequest('http://localhost/api/trips/nope/exchange-records/nope', 'DELETE', undefined),
      { params: { tripId: 'nope', exchangeRecordId: 'nope' } }
    );
    expect(response.status).toBe(401);
  });
});
