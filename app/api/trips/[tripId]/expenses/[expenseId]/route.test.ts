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
let paymentMethodsPostHandler: typeof import('@/app/api/payment-methods/route').POST;
let walletsPostHandler: typeof import('@/app/api/trips/[tripId]/wallets/route').POST;
let walletsGetHandler: typeof import('@/app/api/trips/[tripId]/wallets/route').GET;

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
  ({ POST: paymentMethodsPostHandler } = await import('@/app/api/payment-methods/route'));
  ({ POST: walletsPostHandler, GET: walletsGetHandler } = await import('@/app/api/trips/[tripId]/wallets/route'));
});

async function setupTripWithOwner(name: string, participantNames: string[] = []) {
  const provisionRes = await provisionHandler(jsonRequest('http://localhost/api/account/provision', 'POST', undefined));
  const userToken = provisionRes.cookies.get(USER_SESSION_COOKIE_NAME)?.value!;
  const createTripRes = await tripsPostHandler(
    jsonRequest('http://localhost/api/trips', 'POST', undefined, { name, baseCurrency: 'HKD', ownerDisplayName: 'Remy', participantNames }, userToken)
  );
  expect(createTripRes.status).toBe(201);
  const tripBody = (await createTripRes.json()) as any;
  const tripId: string = tripBody.trip.id;
  const ownerParticipantId: string = tripBody.trip.ownerParticipantId;
  const ownerToken = createTripRes.cookies.get(SESSION_COOKIE_NAME)?.value!;
  return { tripId, ownerToken, ownerParticipantId, participants: tripBody.participants as any[] };
}

async function createCashPaymentMethod(ownerToken: string, label: string, currency: string) {
  const res = await paymentMethodsPostHandler(
    jsonRequest('http://localhost/api/payment-methods', 'POST', ownerToken, { label, kind: 'cash', settlementCurrency: currency }),
    {}
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as any).paymentMethod.id as string;
}

async function createWallet(tripId: string, ownerToken: string, label: string, currency: string, paymentMethodId: string) {
  const res = await walletsPostHandler(
    jsonRequest(`http://localhost/api/trips/${tripId}/wallets`, 'POST', ownerToken, {
      label,
      currency,
      emoji: '💰',
      initialBalance: 0,
      paymentMethodId,
    }),
    { params: { tripId } }
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as any).wallet.id as string;
}

async function getWalletBalance(tripId: string, ownerToken: string, walletId: string) {
  const res = await walletsGetHandler(jsonRequest(`http://localhost/api/trips/${tripId}/wallets`, 'GET', ownerToken), {
    params: { tripId },
  });
  const body = (await res.json()) as any;
  return body.wallets.find((w: any) => w.id === walletId).currentBalance as number;
}

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

/**
 * 第七十轮 bug 1 回归测试："编辑改支付方式旧钱包不退回"根治——真实事故：一笔
 * 消费最初记在「现金 USD」钱包对应的支付方式，后来编辑改成「USDT钱包」，旧代码
 * 从来没把「现金 USD」当初扣的钱退回去，导致这个钱包一直多扣了这笔钱，同一笔钱
 * 同时又在「USDT钱包」那边被正确扣了一次——一笔钱在两个钱包账上各被算了一次。
 * 详见 PENDING-DECISIONS-trip-expense-ledger.md 第七十轮记录。
 *
 * 这几个测试只覆盖"还没设置过当前余额"的钱包（旧的直接写入累加模式）——已经
 * 设置过当前余额的钱包走 wallet-balance.ts 的锚点+推导公式，编辑/删除本来就
 * 自动算对，不需要这里的回滚代码，也不用重复测。
 */
describe('钱包扣减：编辑/删除消费自动退回旧钱包扣款（第七十轮 bug 1 根治）', () => {
  it('编辑消费改支付方式：旧钱包退回全额，新钱包扣全额', async () => {
    const { tripId, ownerToken, ownerParticipantId } = await setupTripWithOwner('🇭🇰测试行程-改支付方式退回旧钱包');
    const cashMethodId = await createCashPaymentMethod(ownerToken, '现金', 'USD');
    const usdtMethodId = await createCashPaymentMethod(ownerToken, 'USDT钱包', 'USD');
    const cashWalletId = await createWallet(tripId, ownerToken, '现金', 'USD', cashMethodId);
    const usdtWalletId = await createWallet(tripId, ownerToken, 'USDT钱包', 'USD', usdtMethodId);

    const expenseRes = await expensesPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses`, 'POST', ownerToken, {
        payerParticipantId: ownerParticipantId,
        amount: 110500, // US$1,105，真实事故金额
        currency: 'USD',
        fxRateUsed: 1,
        category: '🛍️ 购物',
        expenseDate: new Date().toISOString(),
        paymentMethodId: cashMethodId,
      }),
      { params: { tripId } }
    );
    expect(expenseRes.status).toBe(201);
    const expenseId: string = ((await expenseRes.json()) as any).expense.id;

    expect(await getWalletBalance(tripId, ownerToken, cashWalletId)).toBe(-110500);
    expect(await getWalletBalance(tripId, ownerToken, usdtWalletId)).toBe(0);

    const patchRes = await expensePatchHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses/${expenseId}`, 'PATCH', ownerToken, {
        paymentMethodId: usdtMethodId,
      }),
      { params: { tripId, expenseId } }
    );
    expect(patchRes.status).toBe(200);

    // 根因修复的核心断言：现金钱包退回全额（不再多扣），USDT 钱包扣了这笔钱——
    // 不是"两边都扣"或者"两边都不扣"。
    expect(await getWalletBalance(tripId, ownerToken, cashWalletId)).toBe(0);
    expect(await getWalletBalance(tripId, ownerToken, usdtWalletId)).toBe(-110500);
  });

  it('编辑消费改金额（同一个钱包）：只按差额调整，不是先退回全额再扣全额', async () => {
    const { tripId, ownerToken, ownerParticipantId } = await setupTripWithOwner('🇭🇰测试行程-改金额同钱包');
    const methodId = await createCashPaymentMethod(ownerToken, '现金', 'USD');
    const walletId = await createWallet(tripId, ownerToken, '现金', 'USD', methodId);

    const expenseRes = await expensesPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses`, 'POST', ownerToken, {
        payerParticipantId: ownerParticipantId,
        amount: 1000,
        currency: 'USD',
        fxRateUsed: 1,
        category: '🍜 餐饮',
        expenseDate: new Date().toISOString(),
        paymentMethodId: methodId,
      }),
      { params: { tripId } }
    );
    const expenseId: string = ((await expenseRes.json()) as any).expense.id;
    expect(await getWalletBalance(tripId, ownerToken, walletId)).toBe(-1000);

    const patchRes = await expensePatchHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses/${expenseId}`, 'PATCH', ownerToken, {
        amount: 1500,
        currency: 'USD',
        fxRateUsed: 1,
        splits: [{ participantId: ownerParticipantId, shareAmountBaseCurrency: 1500 }],
      }),
      { params: { tripId, expenseId } }
    );
    expect(patchRes.status).toBe(200);
    expect(await getWalletBalance(tripId, ownerToken, walletId)).toBe(-1500);
  });

  it('编辑消费把代垫人从自己改成别人：旧钱包退回全额，别人代垫不扣任何钱包', async () => {
    const { tripId, ownerToken, ownerParticipantId, participants } = await setupTripWithOwner(
      '🇭🇰测试行程-改代垫人退回',
      ['htoo']
    );
    const htooParticipantId: string = participants.find((p) => p.displayName === 'htoo').id;
    const methodId = await createCashPaymentMethod(ownerToken, 'USDT钱包', 'USD');
    const walletId = await createWallet(tripId, ownerToken, 'USDT钱包', 'USD', methodId);

    const expenseRes = await expensesPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses`, 'POST', ownerToken, {
        payerParticipantId: ownerParticipantId,
        amount: 750000,
        currency: 'USD',
        fxRateUsed: 1,
        category: '🛍️ 购物',
        expenseDate: new Date().toISOString(),
        paymentMethodId: methodId,
      }),
      { params: { tripId } }
    );
    const expenseId: string = ((await expenseRes.json()) as any).expense.id;
    expect(await getWalletBalance(tripId, ownerToken, walletId)).toBe(-750000);

    // 这笔钱其实是 htoo 垫付/归还的，编辑改成正确的代垫人——Remy 自己的钱包
    // 应该整笔退回，不该继续扣着。
    const patchRes = await expensePatchHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses/${expenseId}`, 'PATCH', ownerToken, {
        payerParticipantId: htooParticipantId,
      }),
      { params: { tripId, expenseId } }
    );
    expect(patchRes.status).toBe(200);
    expect(await getWalletBalance(tripId, ownerToken, walletId)).toBe(0);
  });

  it('删除消费：退回它当初扣掉的钱包余额', async () => {
    const { tripId, ownerToken, ownerParticipantId } = await setupTripWithOwner('🇭🇰测试行程-删除退回');
    const methodId = await createCashPaymentMethod(ownerToken, '现金', 'USD');
    const walletId = await createWallet(tripId, ownerToken, '现金', 'USD', methodId);

    const expenseRes = await expensesPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses`, 'POST', ownerToken, {
        payerParticipantId: ownerParticipantId,
        amount: 2000,
        currency: 'USD',
        fxRateUsed: 1,
        category: '🍜 餐饮',
        expenseDate: new Date().toISOString(),
        paymentMethodId: methodId,
      }),
      { params: { tripId } }
    );
    const expenseId: string = ((await expenseRes.json()) as any).expense.id;
    expect(await getWalletBalance(tripId, ownerToken, walletId)).toBe(-2000);

    const deleteRes = await expenseDeleteHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses/${expenseId}`, 'DELETE', ownerToken),
      { params: { tripId, expenseId } }
    );
    expect(deleteRes.status).toBe(204);
    expect(await getWalletBalance(tripId, ownerToken, walletId)).toBe(0);
  });
});
