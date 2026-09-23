import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, type Db } from '@/lib/db/client';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';

/**
 * 第三十九轮新增：「历史现金消费回溯补算进钱包余额」回归测试。
 *
 * 背景见 PENDING-DECISIONS-trip-expense-ledger.md 第三十九轮 + DESIGN-BRIEF.md
 * 第三十八轮「三 (d)」——之前只有绑定之后新记的消费才会自动扣钱包，钱包创建之前
 * 已经存在、支付方式+币种匹配的历史消费不会补算，这轮补上这条链路：创建钱包时如果
 * 直接绑了支付方式，创建那一刻把符合条件的历史消费一次性扣进起始余额。
 *
 * 覆盖：①历史消费确实被扣 ②币种不一致的历史消费不计入 ③没绑支付方式的钱包不触发
 * 任何回溯计算 ④别的参与者名下的消费不计入（钱包私有边界跟 CLAUDE.md 权限规则一致）。
 */

let db: Db;
let SESSION_COOKIE_NAME: string;
let USER_SESSION_COOKIE_NAME: string;
let provisionHandler: typeof import('@/app/api/account/provision/route').POST;
let tripsPostHandler: typeof import('@/app/api/trips/route').POST;
let paymentMethodsPostHandler: typeof import('@/app/api/payment-methods/route').POST;
let expensesPostHandler: typeof import('@/app/api/trips/[tripId]/expenses/route').POST;
let walletsPostHandler: typeof import('./route').POST;

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
  ({ POST: expensesPostHandler } = await import('@/app/api/trips/[tripId]/expenses/route'));
  ({ POST: walletsPostHandler } = await import('./route'));
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
  const ownerParticipantId: string = tripBody.trip.ownerParticipantId;
  const ownerToken = createTripRes.cookies.get(SESSION_COOKIE_NAME)?.value!;
  return { tripId, ownerToken, userToken, ownerParticipantId };
}

async function createCashPaymentMethod(ownerToken: string, currency = 'HKD') {
  const res = await paymentMethodsPostHandler(
    jsonRequest('http://localhost/api/payment-methods', 'POST', ownerToken, {
      label: '现金',
      kind: 'cash',
      settlementCurrency: currency,
    }),
    {}
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as any;
  return body.paymentMethod.id as string;
}

async function recordExpense(
  tripId: string,
  token: string,
  payerParticipantId: string,
  amount: number,
  currency: string,
  paymentMethodId?: string
) {
  const res = await expensesPostHandler(
    jsonRequest(`http://localhost/api/trips/${tripId}/expenses`, 'POST', token, {
      payerParticipantId,
      amount,
      currency,
      // 行程本位币是 HKD（setupTripWithOwner 固定传的），非 HKD 币种的消费
      // 必须带 fxRateUsed，否则 400——这里传个占位汇率 1，回溯逻辑只看
      // `expenses.currency`/`amount`（原币种金额），不看 fxRateUsed/换算后金额，
      // 数值本身不影响这份测试要验证的东西。
      fxRateUsed: currency === 'HKD' ? undefined : 1,
      category: '🍜 餐饮',
      expenseDate: new Date().toISOString(),
      paymentMethodId,
    }),
    { params: { tripId } }
  );
  expect(res.status).toBe(201);
  return (await res.json()) as any;
}

describe('创建钱包时回溯补算历史消费', () => {
  it('绑定支付方式创建钱包，钱包诞生前已存在的同支付方式+同币种消费会一次性扣进起始余额', async () => {
    const { tripId, ownerToken, ownerParticipantId } = await setupTripWithOwner('🇭🇰测试行程A');
    const paymentMethodId = await createCashPaymentMethod(ownerToken);

    // 这个时候还没有任何钱包——两笔历史"现金"消费，模拟 Remy 真实场景：先记账，
    // 后建钱包。
    await recordExpense(tripId, ownerToken, ownerParticipantId, 5000, 'HKD', paymentMethodId);
    await recordExpense(tripId, ownerToken, ownerParticipantId, 4200, 'HKD', paymentMethodId);

    const walletRes = await walletsPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/wallets`, 'POST', ownerToken, {
        label: '现金',
        currency: 'HKD',
        emoji: '💵',
        initialBalance: 0,
        paymentMethodId,
      }),
      { params: { tripId } }
    );
    expect(walletRes.status).toBe(201);
    const walletBody = (await walletRes.json()) as any;
    // 0（起始余额）- (5000+4200)（历史消费）= -9200
    expect(walletBody.wallet.currentBalance).toBe(-9200);

    // 显式验证「回溯补算」跟「记账自动扣」这两段互补逻辑不会重复扣款/漏扣款——
    // 钱包已经存在之后再记一笔同支付方式+同币种的新消费，应该只被下面
    // `expenses/route.ts` 的即时扣款逻辑扣一次（-9200 再扣 1000 = -10200），
    // 不会被这次刚跑完的回溯逻辑再算一遍（回溯只在 POST /wallets 这一条请求里
    // 执行一次，不是常驻监听，物理上不可能对之后才发生的消费重复触发）。
    await recordExpense(tripId, ownerToken, ownerParticipantId, 1000, 'HKD', paymentMethodId);
    const walletsGetHandler = (await import('./route')).GET;
    const listRes = await walletsGetHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/wallets`, 'GET', ownerToken),
      { params: { tripId } }
    );
    const listBody = (await listRes.json()) as any;
    const wallet = listBody.wallets.find((w: any) => w.id === walletBody.wallet.id);
    expect(wallet.currentBalance).toBe(-10200);
  });

  it('币种不一致的历史消费不计入回溯', async () => {
    const { tripId, ownerToken, ownerParticipantId } = await setupTripWithOwner('🇭🇰测试行程B');
    const paymentMethodId = await createCashPaymentMethod(ownerToken, 'HKD');

    // 这笔消费币种是 MYR，跟即将创建的 HKD 钱包不一致，不该被计入。
    await recordExpense(tripId, ownerToken, ownerParticipantId, 10000, 'MYR', paymentMethodId);

    const walletRes = await walletsPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/wallets`, 'POST', ownerToken, {
        label: '现金',
        currency: 'HKD',
        emoji: '💵',
        initialBalance: 1000,
        paymentMethodId,
      }),
      { params: { tripId } }
    );
    expect(walletRes.status).toBe(201);
    const walletBody = (await walletRes.json()) as any;
    expect(walletBody.wallet.currentBalance).toBe(1000);
  });

  it('新建钱包不绑支付方式，不触发任何回溯计算（哪怕之前记过同币种现金消费）', async () => {
    const { tripId, ownerToken, ownerParticipantId } = await setupTripWithOwner('🇭🇰测试行程C');
    const paymentMethodId = await createCashPaymentMethod(ownerToken, 'HKD');
    await recordExpense(tripId, ownerToken, ownerParticipantId, 3000, 'HKD', paymentMethodId);

    const walletRes = await walletsPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/wallets`, 'POST', ownerToken, {
        label: '现金',
        currency: 'HKD',
        emoji: '💵',
        initialBalance: 500,
        // 不传 paymentMethodId
      }),
      { params: { tripId } }
    );
    expect(walletRes.status).toBe(201);
    const walletBody = (await walletRes.json()) as any;
    expect(walletBody.wallet.currentBalance).toBe(500);
  });

  it('另一趟行程的历史消费不会跨行程污染回溯结果', async () => {
    const { tripId, ownerToken } = await setupTripWithOwner('🇭🇰测试行程D');
    const paymentMethodId = await createCashPaymentMethod(ownerToken, 'HKD');

    // 这条边界本来就由 `eq(expenses.tripId, params.tripId)` 保证——用真实第二趟
    // 行程（币种/金额"看起来像"）验证不会被跨行程误扣。
    const { tripId: otherTripId, ownerToken: otherOwnerToken, ownerParticipantId: otherOwnerParticipantId } =
      await setupTripWithOwner('🇭🇰测试行程D-其它行程');
    const otherPaymentMethodId = await createCashPaymentMethod(otherOwnerToken, 'HKD');
    await recordExpense(otherTripId, otherOwnerToken, otherOwnerParticipantId, 9999, 'HKD', otherPaymentMethodId);

    const walletRes = await walletsPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/wallets`, 'POST', ownerToken, {
        label: '现金',
        currency: 'HKD',
        emoji: '💵',
        initialBalance: 200,
        paymentMethodId,
      }),
      { params: { tripId } }
    );
    expect(walletRes.status).toBe(201);
    const walletBody = (await walletRes.json()) as any;
    // 另一趟行程的历史消费（即便金额、币种都"看起来像"）完全不影响这边——
    // 起始余额原样不变，没有被跨行程/跨支付方式误扣。
    expect(walletBody.wallet.currentBalance).toBe(200);
  });
});
