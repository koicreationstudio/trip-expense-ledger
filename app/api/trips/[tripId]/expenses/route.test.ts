import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, type Db } from '@/lib/db/client';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';

/**
 * 第七十轮 bug 2 回归测试：记账自动扣钱包余额，只有「付款人就是钱包主人自己」
 * 才该扣（`payerParticipantId`），不能看「谁把这条记录敲进系统」
 * （`enteredByParticipantId`）——这两个字段绝大多数时候恰好是同一个人（自己
 * 记自己的账），但这个 app 支持"帮别人代录"（Remy 帮 htoo 把 htoo 自己垫付的
 * 钱记进系统），这种场景下旧代码会错误地从 Remy 自己的钱包扣钱，即使这笔钱根本
 * 不是 Remy 出的。
 *
 * 背景：真实事故是 htoo 垫付/归还的一笔 US$7,500（payerParticipantId=htoo），
 * 被从 Remy 自己的 USDT 钱包里扣掉了，因为 Remy 是登录着把这条记录敲进系统的人
 * （enteredByParticipantId=Remy），旧代码就是拿这个字段去匹配"该扣谁的钱包"。
 * 详见 PENDING-DECISIONS-trip-expense-ledger.md 第七十轮记录。
 */

let db: Db;
let SESSION_COOKIE_NAME: string;
let USER_SESSION_COOKIE_NAME: string;
let provisionHandler: typeof import('@/app/api/account/provision/route').POST;
let tripsPostHandler: typeof import('@/app/api/trips/route').POST;
let paymentMethodsPostHandler: typeof import('@/app/api/payment-methods/route').POST;
let expensesPostHandler: typeof import('./route').POST;
let walletsPostHandler: typeof import('../wallets/route').POST;
let walletsGetHandler: typeof import('../wallets/route').GET;

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
  ({ POST: paymentMethodsPostHandler } = await import('@/app/api/payment-methods/route'));
  ({ POST: expensesPostHandler } = await import('./route'));
  ({ POST: walletsPostHandler, GET: walletsGetHandler } = await import('../wallets/route'));
});

afterAll(async () => {
  await teardownTestDb();
});

async function setupTripWithTwoParticipants(name: string) {
  const provisionRes = await provisionHandler(jsonRequest('http://localhost/api/account/provision', 'POST', undefined));
  const userToken = provisionRes.cookies.get(USER_SESSION_COOKIE_NAME)?.value!;
  const createTripRes = await tripsPostHandler(
    jsonRequest('http://localhost/api/trips', 'POST', undefined, {
      name,
      baseCurrency: 'HKD',
      ownerDisplayName: 'Remy',
      participantNames: ['htoo'],
    }, userToken)
  );
  expect(createTripRes.status).toBe(201);
  const tripBody = (await createTripRes.json()) as any;
  const tripId: string = tripBody.trip.id;
  const ownerParticipantId: string = tripBody.trip.ownerParticipantId;
  const ownerToken = createTripRes.cookies.get(SESSION_COOKIE_NAME)?.value!;
  const htooParticipantId: string = tripBody.participants.find((p: any) => p.displayName === 'htoo').id;
  return { tripId, ownerToken, ownerParticipantId, htooParticipantId };
}

async function createCashPaymentMethod(ownerToken: string, currency = 'USD') {
  const res = await paymentMethodsPostHandler(
    jsonRequest('http://localhost/api/payment-methods', 'POST', ownerToken, {
      label: 'USDT钱包',
      kind: 'cash',
      settlementCurrency: currency,
    }),
    {}
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as any;
  return body.paymentMethod.id as string;
}

async function getWalletBalance(tripId: string, ownerToken: string, walletId: string) {
  const res = await walletsGetHandler(jsonRequest(`http://localhost/api/trips/${tripId}/wallets`, 'GET', ownerToken), {
    params: { tripId },
  });
  const body = (await res.json()) as any;
  return body.wallets.find((w: any) => w.id === walletId).currentBalance as number;
}

describe('记一笔消费自动扣钱包：只认付款人（payerParticipantId），不认代录人（enteredByParticipantId）', () => {
  it('Remy 登录帮 htoo 代录一笔 htoo 自己垫付的消费，不该扣 Remy 自己的钱包（第七十轮 bug 2 根治）', async () => {
    const { tripId, ownerToken, ownerParticipantId, htooParticipantId } = await setupTripWithTwoParticipants(
      '🇭🇰测试行程-代录不扣自己钱包'
    );
    const paymentMethodId = await createCashPaymentMethod(ownerToken, 'USD');

    const walletRes = await walletsPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/wallets`, 'POST', ownerToken, {
        label: 'USDT钱包',
        currency: 'USD',
        emoji: '💰',
        initialBalance: 0,
        paymentMethodId,
      }),
      { params: { tripId } }
    );
    expect(walletRes.status).toBe(201);
    const walletId: string = ((await walletRes.json()) as any).wallet.id;

    // Remy（登录中，enteredByParticipantId=Remy）帮 htoo 代录一笔 htoo 自己垫付
    // 的消费（payerParticipantId=htoo），还顺手选了看起来匹配的支付方式——这笔
    // 钱根本不是 Remy 出的，Remy 的钱包不该被扣。
    const expenseRes = await expensesPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses`, 'POST', ownerToken, {
        payerParticipantId: htooParticipantId,
        amount: 750000, // US$7,500，真实事故金额
        currency: 'USD',
        fxRateUsed: 1,
        category: '🛍️ 购物',
        expenseDate: new Date().toISOString(),
        paymentMethodId,
      }),
      { params: { tripId } }
    );
    expect(expenseRes.status).toBe(201);

    expect(await getWalletBalance(tripId, ownerToken, walletId)).toBe(0);
  });

  it('对照组：Remy 自己付款、自己记账，正常扣自己的钱包', async () => {
    const { tripId, ownerToken, ownerParticipantId } = await setupTripWithTwoParticipants('🇭🇰测试行程-自付自扣对照组');
    const paymentMethodId = await createCashPaymentMethod(ownerToken, 'USD');

    const walletRes = await walletsPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/wallets`, 'POST', ownerToken, {
        label: 'USDT钱包',
        currency: 'USD',
        emoji: '💰',
        initialBalance: 0,
        paymentMethodId,
      }),
      { params: { tripId } }
    );
    const walletId: string = ((await walletRes.json()) as any).wallet.id;

    const expenseRes = await expensesPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses`, 'POST', ownerToken, {
        payerParticipantId: ownerParticipantId,
        amount: 30000,
        currency: 'USD',
        fxRateUsed: 1,
        category: '🍜 餐饮',
        expenseDate: new Date().toISOString(),
        paymentMethodId,
      }),
      { params: { tripId } }
    );
    expect(expenseRes.status).toBe(201);

    expect(await getWalletBalance(tripId, ownerToken, walletId)).toBe(-30000);
  });
});
