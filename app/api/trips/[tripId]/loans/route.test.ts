import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, type Db } from '@/lib/db/client';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';

/**
 * round72b：借钱/还钱功能的 HTTP 层测试——重点补 lib/domain/wallet-balance.test.ts
 * 那份测试没覆盖到的部分：**未锚定钱包**（`balanceUpdatedAt` 仍是 null，新建钱包
 * 默认就是这个状态）在 POST 路由里直接写 currentBalance 的路径，这条路径不经过
 * computeWalletDisplayBalance，只能靠打真实 HTTP handler 才能验到。
 */

let db: Db;
let SESSION_COOKIE_NAME: string;
let USER_SESSION_COOKIE_NAME: string;
let provisionHandler: typeof import('@/app/api/account/provision/route').POST;
let tripsPostHandler: typeof import('@/app/api/trips/route').POST;
let walletsPostHandler: typeof import('@/app/api/trips/[tripId]/wallets/route').POST;
let walletsGetHandler: typeof import('@/app/api/trips/[tripId]/wallets/route').GET;
let loansPostHandler: typeof import('./route').POST;
let loansGetHandler: typeof import('./route').GET;
let repaymentsPostHandler: typeof import('./[loanId]/repayments/route').POST;
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
  ({ POST: loansPostHandler, GET: loansGetHandler } = await import('./route'));
  ({ POST: repaymentsPostHandler } = await import('./[loanId]/repayments/route'));
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
      { name: '香港', baseCurrency: 'HKD', ownerDisplayName: 'Remy', participantNames: ['htoo', '路人'] },
      aUserToken
    )
  );
  const tripBody = (await createTripResponse.json()) as any;
  const tripId: string = tripBody.trip.id;
  const aToken = createTripResponse.cookies.get(SESSION_COOKIE_NAME)?.value as string;
  const ownerId = tripBody.participants.find((p: { displayName: string }) => p.displayName === 'Remy').id;
  const htooParticipant = tripBody.participants.find((p: { displayName: string }) => p.displayName === 'htoo');
  const strangerParticipant = tripBody.participants.find((p: { displayName: string }) => p.displayName === '路人');
  const htooToken = await createSession(db, htooParticipant.id, null);
  const strangerToken = await createSession(db, strangerParticipant.id, null);

  return {
    tripId,
    aToken,
    ownerId,
    htooId: htooParticipant.id as string,
    htooToken,
    strangerId: strangerParticipant.id as string,
    strangerToken,
  };
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

describe('POST /loans（借出，未锚定钱包直接扣款路径）', () => {
  it('借出当下即时减少来源钱包余额（未锚定/累加模式，跟 exchange-records POST 同一条写入路径）', async () => {
    const { tripId, aToken, ownerId, htooId } = await setupTripWithOwnerAndOther();
    const walletId = await createWallet(tripId, aToken, '现金USD', 'USD');

    const res = await loansPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/loans`, 'POST', aToken, {
        lenderParticipantId: ownerId,
        borrowerParticipantId: htooId,
        amount: 750000,
        currency: 'USD',
        fromWalletId: walletId,
        date: new Date().toISOString(),
      }),
      { params: { tripId } }
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.loan.amount).toBe(750000);
    expect(body.loan.progress.status).toBe('unpaid');

    expect(await getWalletBalance(tripId, aToken, walletId)).toBe(-750000);
  });

  it('fromWalletId 不填（不经过任何钱包），不影响任何钱包余额，记录照样建成功（开放问题①）', async () => {
    const { tripId, aToken, ownerId, htooId } = await setupTripWithOwnerAndOther();
    const walletId = await createWallet(tripId, aToken, '现金USD', 'USD');

    const res = await loansPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/loans`, 'POST', aToken, {
        lenderParticipantId: ownerId,
        borrowerParticipantId: htooId,
        amount: 100000,
        currency: 'USD',
        date: new Date().toISOString(),
      }),
      { params: { tripId } }
    );
    expect(res.status).toBe(201);
    expect(await getWalletBalance(tripId, aToken, walletId)).toBe(0);
  });

  it('lender 跟 borrower 是同一个人，拒绝', async () => {
    const { tripId, aToken, ownerId } = await setupTripWithOwnerAndOther();
    const res = await loansPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/loans`, 'POST', aToken, {
        lenderParticipantId: ownerId,
        borrowerParticipantId: ownerId,
        amount: 1000,
        currency: 'USD',
        date: new Date().toISOString(),
      }),
      { params: { tripId } }
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe('lender_borrower_same');
  });

  it('选的 fromWalletId 不是自己名下的钱包，拒绝（跟 exchange-records 同一条私有规矩）', async () => {
    const { tripId, aToken, ownerId, htooId, htooToken } = await setupTripWithOwnerAndOther();
    const ownerWallet = await createWallet(tripId, aToken, '现金USD', 'USD');

    const res = await loansPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/loans`, 'POST', htooToken, {
        lenderParticipantId: htooId,
        borrowerParticipantId: ownerId,
        amount: 1000,
        currency: 'USD',
        fromWalletId: ownerWallet,
        date: new Date().toISOString(),
      }),
      { params: { tripId } }
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe('invalid_from_wallet');
  });
});

describe('POST /loans/:loanId/repayments（还款，未锚定钱包直接加款路径）', () => {
  it('部分还款多次通过真实 HTTP 请求正确累加（③），全部还清后 status 变成 paid（④）', async () => {
    const { tripId, aToken, ownerId, htooId } = await setupTripWithOwnerAndOther();
    const fromWallet = await createWallet(tripId, aToken, '现金USD', 'USD');
    const toWallet = await createWallet(tripId, aToken, 'USDT钱包', 'USD');

    const loanRes = await loansPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/loans`, 'POST', aToken, {
        lenderParticipantId: ownerId,
        borrowerParticipantId: htooId,
        amount: 100000,
        currency: 'USD',
        fromWalletId: fromWallet,
        date: new Date().toISOString(),
      }),
      { params: { tripId } }
    );
    const loanId = ((await loanRes.json()) as any).loan.id as string;

    const repay1 = await repaymentsPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/loans/${loanId}/repayments`, 'POST', aToken, {
        amount: 40000,
        toWalletId: toWallet,
        date: new Date().toISOString(),
      }),
      { params: { tripId, loanId } }
    );
    expect(repay1.status).toBe(201);
    const repay1Body = (await repay1.json()) as any;
    expect(repay1Body.progress.repaidAmount).toBe(40000);
    expect(repay1Body.progress.status).toBe('partial');
    expect(await getWalletBalance(tripId, aToken, toWallet)).toBe(40000);
    // 借出钱包不受还款影响，只受借出本身影响。
    expect(await getWalletBalance(tripId, aToken, fromWallet)).toBe(-100000);

    const repay2 = await repaymentsPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/loans/${loanId}/repayments`, 'POST', aToken, {
        amount: 60000,
        toWalletId: toWallet,
        date: new Date().toISOString(),
      }),
      { params: { tripId, loanId } }
    );
    expect(repay2.status).toBe(201);
    const repay2Body = (await repay2.json()) as any;
    expect(repay2Body.progress.repaidAmount).toBe(100000);
    expect(repay2Body.progress.status).toBe('paid');
    expect(repay2Body.progress.outstandingAmount).toBe(0);
    expect(await getWalletBalance(tripId, aToken, toWallet)).toBe(100000);

    // GET 列表也反映同一份进度（不是 POST 响应里现算一次、GET 另一套逻辑）。
    const listRes = await loansGetHandler(jsonRequest(`http://localhost/api/trips/${tripId}/loans`, 'GET', aToken), {
      params: { tripId },
    });
    const listBody = (await listRes.json()) as any;
    const listedLoan = listBody.loans.find((l: any) => l.id === loanId);
    expect(listedLoan.progress.status).toBe('paid');
    expect(listedLoan.progress.repaidAmount).toBe(100000);
  });

  it('toWalletId 不填不影响任何钱包余额，但还款记录/进度照样生效', async () => {
    const { tripId, aToken, ownerId, htooId } = await setupTripWithOwnerAndOther();
    const fromWallet = await createWallet(tripId, aToken, '现金USD', 'USD');
    const unrelatedWallet = await createWallet(tripId, aToken, '别的钱包', 'HKD');

    const loanRes = await loansPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/loans`, 'POST', aToken, {
        lenderParticipantId: ownerId,
        borrowerParticipantId: htooId,
        amount: 50000,
        currency: 'USD',
        fromWalletId: fromWallet,
        date: new Date().toISOString(),
      }),
      { params: { tripId } }
    );
    const loanId = ((await loanRes.json()) as any).loan.id as string;

    const repay = await repaymentsPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/loans/${loanId}/repayments`, 'POST', aToken, {
        amount: 20000,
        date: new Date().toISOString(),
      }),
      { params: { tripId, loanId } }
    );
    expect(repay.status).toBe(201);
    expect(((await repay.json()) as any).progress.repaidAmount).toBe(20000);
    expect(await getWalletBalance(tripId, aToken, unrelatedWallet)).toBe(0);
  });

  it('不是这笔 loan 的当事人（既不是 lender 也不是 borrower）还款一律 404', async () => {
    const { tripId, aToken, ownerId, htooId, strangerToken } = await setupTripWithOwnerAndOther();
    const loanRes = await loansPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/loans`, 'POST', aToken, {
        lenderParticipantId: ownerId,
        borrowerParticipantId: htooId,
        amount: 50000,
        currency: 'USD',
        date: new Date().toISOString(),
      }),
      { params: { tripId } }
    );
    const loanId = ((await loanRes.json()) as any).loan.id as string;

    const repay = await repaymentsPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/loans/${loanId}/repayments`, 'POST', strangerToken, {
        amount: 1000,
        date: new Date().toISOString(),
      }),
      { params: { tripId, loanId } }
    );
    expect(repay.status).toBe(404);
  });

  it('borrower（不是 lender）也能记还款——两个当事人都算数（GET 列表这条私密边界的另一半）', async () => {
    const { tripId, aToken, ownerId, htooId, htooToken } = await setupTripWithOwnerAndOther();
    const loanRes = await loansPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/loans`, 'POST', aToken, {
        lenderParticipantId: ownerId,
        borrowerParticipantId: htooId,
        amount: 50000,
        currency: 'USD',
        date: new Date().toISOString(),
      }),
      { params: { tripId } }
    );
    const loanId = ((await loanRes.json()) as any).loan.id as string;

    const repay = await repaymentsPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/loans/${loanId}/repayments`, 'POST', htooToken, {
        amount: 20000,
        date: new Date().toISOString(),
      }),
      { params: { tripId, loanId } }
    );
    expect(repay.status).toBe(201);

    const listRes = await loansGetHandler(jsonRequest(`http://localhost/api/trips/${tripId}/loans`, 'GET', htooToken), {
      params: { tripId },
    });
    const listBody = (await listRes.json()) as any;
    expect(listBody.loans.find((l: any) => l.id === loanId).progress.repaidAmount).toBe(20000);
  });
});

describe('GET /loans：私密边界（当事人之一才能看）', () => {
  it('跟这笔 loan 无关的第三个参与者，列表里看不到它', async () => {
    const { tripId, aToken, ownerId, htooId, strangerToken } = await setupTripWithOwnerAndOther();
    await loansPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/loans`, 'POST', aToken, {
        lenderParticipantId: ownerId,
        borrowerParticipantId: htooId,
        amount: 50000,
        currency: 'USD',
        date: new Date().toISOString(),
      }),
      { params: { tripId } }
    );

    const listRes = await loansGetHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/loans`, 'GET', strangerToken),
      { params: { tripId } }
    );
    const listBody = (await listRes.json()) as any;
    expect(listBody.loans).toHaveLength(0);
  });

  it('没带 session cookie 一律 401', async () => {
    const response = await loansGetHandler(jsonRequest('http://localhost/api/trips/nope/loans', 'GET', undefined), {
      params: { tripId: 'nope' },
    });
    expect(response.status).toBe(401);
  });
});
