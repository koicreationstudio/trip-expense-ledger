import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, type Db } from '@/lib/db/client';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';

/**
 * 第五十轮新增："设置当前余额"覆盖式 bug 回归测试。
 *
 * 背景见 PENDING-DECISIONS-trip-expense-ledger.md 第五十轮——生产事故：Remy 给
 * 香港行程现金 HKD 钱包填了 8120、记录日期 2026-09-15，结果把历史回溯算出来的
 * -HK$246（09-15 及以后已经存在的消费）整个覆盖掉，行程主页显示的余额没有扣掉
 * 这几笔消费。根因是 PATCH /wallets/[walletId] 直接绝对覆写 currentBalance，完全
 * 不参照记录日期。
 *
 * 这次改成 lib/domain/wallet-balance.ts 的"锚点+推导"架构：钱包做过一次"设置当前
 * 余额"（`balanceUpdatedAt` 非空）之后，显示余额永远是现查现算，不再是某处直接写
 * 出来的固定值。这份测试覆盖 Remy 明确要求的全部边界场景：
 *
 * ①设置锚点时已有消费（这次的 bug 现场）②锚点之后新增消费③编辑消费金额
 * ④删除消费⑤编辑消费日期跨过锚点⑥编辑消费支付方式（换入/换出这个钱包）
 * ⑦锚点日期起的换汇净额也要纳入重算范围。
 */

let db: Db;
let SESSION_COOKIE_NAME: string;
let USER_SESSION_COOKIE_NAME: string;
let provisionHandler: typeof import('@/app/api/account/provision/route').POST;
let tripsPostHandler: typeof import('@/app/api/trips/route').POST;
let paymentMethodsPostHandler: typeof import('@/app/api/payment-methods/route').POST;
let expensesPostHandler: typeof import('@/app/api/trips/[tripId]/expenses/route').POST;
let expensePatchHandler: typeof import('@/app/api/trips/[tripId]/expenses/[expenseId]/route').PATCH;
let expenseDeleteHandler: typeof import('@/app/api/trips/[tripId]/expenses/[expenseId]/route').DELETE;
let walletsPostHandler: typeof import('../route').POST;
let walletsGetHandler: typeof import('../route').GET;
let walletPatchHandler: typeof import('./route').PATCH;
let exchangeRecordsPostHandler: typeof import('@/app/api/trips/[tripId]/exchange-records/route').POST;
let exchangeRecordDeleteHandler: typeof import('@/app/api/trips/[tripId]/exchange-records/[exchangeRecordId]/route').DELETE;

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
  ({ PATCH: expensePatchHandler, DELETE: expenseDeleteHandler } = await import(
    '@/app/api/trips/[tripId]/expenses/[expenseId]/route'
  ));
  ({ POST: walletsPostHandler, GET: walletsGetHandler } = await import('../route'));
  ({ PATCH: walletPatchHandler } = await import('./route'));
  ({ POST: exchangeRecordsPostHandler } = await import('@/app/api/trips/[tripId]/exchange-records/route'));
  ({ DELETE: exchangeRecordDeleteHandler } = await import(
    '@/app/api/trips/[tripId]/exchange-records/[exchangeRecordId]/route'
  ));
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

async function createWallet(
  tripId: string,
  ownerToken: string,
  opts: { currency?: string; paymentMethodId?: string; initialBalance?: number; label?: string } = {}
) {
  const res = await walletsPostHandler(
    jsonRequest(`http://localhost/api/trips/${tripId}/wallets`, 'POST', ownerToken, {
      label: opts.label ?? '现金',
      currency: opts.currency ?? 'HKD',
      emoji: '💵',
      initialBalance: opts.initialBalance ?? 0,
      paymentMethodId: opts.paymentMethodId,
    }),
    { params: { tripId } }
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as any).wallet as { id: string; currentBalance: number };
}

async function recordExpense(
  tripId: string,
  token: string,
  payerParticipantId: string,
  amount: number,
  currency: string,
  expenseDateIso: string,
  paymentMethodId?: string
) {
  const res = await expensesPostHandler(
    jsonRequest(`http://localhost/api/trips/${tripId}/expenses`, 'POST', token, {
      payerParticipantId,
      amount,
      currency,
      fxRateUsed: currency === 'HKD' ? undefined : 1,
      category: '🍜 餐饮',
      expenseDate: expenseDateIso,
      paymentMethodId,
    }),
    { params: { tripId } }
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as any).expense as { id: string };
}

async function setWalletBalance(tripId: string, ownerToken: string, walletId: string, currentBalance: number, balanceUpdatedAt: string) {
  const res = await walletPatchHandler(
    jsonRequest(`http://localhost/api/trips/${tripId}/wallets/${walletId}`, 'PATCH', ownerToken, {
      currentBalance,
      balanceUpdatedAt,
    }),
    { params: { tripId, walletId } }
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as any).wallet as { currentBalance: number; balanceUpdatedAt: string | null };
}

async function getWalletBalance(tripId: string, ownerToken: string, walletId: string) {
  const res = await walletsGetHandler(jsonRequest(`http://localhost/api/trips/${tripId}/wallets`, 'GET', ownerToken), {
    params: { tripId },
  });
  const body = (await res.json()) as any;
  return body.wallets.find((w: any) => w.id === walletId).currentBalance as number;
}

const ANCHOR = '2026-09-15T00:00:00.000Z';
const BEFORE_ANCHOR = '2026-09-14T00:00:00.000Z';
const ON_ANCHOR = '2026-09-15T08:00:00.000Z';
const AFTER_ANCHOR = '2026-09-17T00:00:00.000Z';

describe('设置当前余额：锚点+推导架构', () => {
  it('①设置锚点时，记录日期当天及以后已存在的消费会被扣，之前的不会（这次修的生产 bug 场景）', async () => {
    const { tripId, ownerToken, ownerParticipantId } = await setupTripWithOwner('🇭🇰测试-锚点已有消费');
    const paymentMethodId = await createCashPaymentMethod(ownerToken);
    const wallet = await createWallet(tripId, ownerToken, { paymentMethodId });

    // 09-14（锚点之前，不该扣）+ 09-15 当天（边界，"当天算在内"，该扣）+ 09-16（该扣）
    await recordExpense(tripId, ownerToken, ownerParticipantId, 2000, 'HKD', BEFORE_ANCHOR, paymentMethodId);
    await recordExpense(tripId, ownerToken, ownerParticipantId, 5000, 'HKD', ON_ANCHOR, paymentMethodId);
    await recordExpense(tripId, ownerToken, ownerParticipantId, 1000, 'HKD', AFTER_ANCHOR, paymentMethodId);

    const updated = await setWalletBalance(tripId, ownerToken, wallet.id, 812000, ANCHOR);
    // 8120 - (5000+1000) = 806000；2000 的那笔（09-14，锚点之前）不计入
    expect(updated.currentBalance).toBe(806000);
    expect(await getWalletBalance(tripId, ownerToken, wallet.id)).toBe(806000);
  });

  it('②锚点之后新增的消费会自动扣，倒填成锚点之前日期的新消费不会扣', async () => {
    const { tripId, ownerToken, ownerParticipantId } = await setupTripWithOwner('🇭🇰测试-锚点后新增');
    const paymentMethodId = await createCashPaymentMethod(ownerToken);
    const wallet = await createWallet(tripId, ownerToken, { paymentMethodId });
    await setWalletBalance(tripId, ownerToken, wallet.id, 100000, ANCHOR);

    await recordExpense(tripId, ownerToken, ownerParticipantId, 3000, 'HKD', AFTER_ANCHOR, paymentMethodId);
    expect(await getWalletBalance(tripId, ownerToken, wallet.id)).toBe(97000);

    await recordExpense(tripId, ownerToken, ownerParticipantId, 500, 'HKD', BEFORE_ANCHOR, paymentMethodId);
    // 倒填成锚点之前的新消费不扣——语义上"锚点值本来就已经反映了这天之前的状态"
    expect(await getWalletBalance(tripId, ownerToken, wallet.id)).toBe(97000);
  });

  it('③编辑消费金额会实时反映到已锚定钱包的余额', async () => {
    const { tripId, ownerToken, ownerParticipantId } = await setupTripWithOwner('🇭🇰测试-编辑金额');
    const paymentMethodId = await createCashPaymentMethod(ownerToken);
    const wallet = await createWallet(tripId, ownerToken, { paymentMethodId });
    await setWalletBalance(tripId, ownerToken, wallet.id, 100000, ANCHOR);

    const expense = await recordExpense(tripId, ownerToken, ownerParticipantId, 5000, 'HKD', AFTER_ANCHOR, paymentMethodId);
    expect(await getWalletBalance(tripId, ownerToken, wallet.id)).toBe(95000);

    const patchRes = await expensePatchHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses/${expense.id}`, 'PATCH', ownerToken, {
        amount: 8000,
        currency: 'HKD',
        splits: [{ participantId: ownerParticipantId, shareAmountBaseCurrency: 8000 }],
      }),
      { params: { tripId, expenseId: expense.id } }
    );
    expect(patchRes.status).toBe(200);
    expect(await getWalletBalance(tripId, ownerToken, wallet.id)).toBe(92000);
  });

  it('④删除消费会把这笔金额加回已锚定钱包的余额', async () => {
    const { tripId, ownerToken, ownerParticipantId } = await setupTripWithOwner('🇭🇰测试-删除消费');
    const paymentMethodId = await createCashPaymentMethod(ownerToken);
    const wallet = await createWallet(tripId, ownerToken, { paymentMethodId });
    await setWalletBalance(tripId, ownerToken, wallet.id, 100000, ANCHOR);

    const expense = await recordExpense(tripId, ownerToken, ownerParticipantId, 6000, 'HKD', AFTER_ANCHOR, paymentMethodId);
    expect(await getWalletBalance(tripId, ownerToken, wallet.id)).toBe(94000);

    const deleteRes = await expenseDeleteHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses/${expense.id}`, 'DELETE', ownerToken),
      { params: { tripId, expenseId: expense.id } }
    );
    expect(deleteRes.status).toBe(204);
    expect(await getWalletBalance(tripId, ownerToken, wallet.id)).toBe(100000);
  });

  it('⑤编辑消费日期跨过锚点，会相应改变是否计入余额（双向）', async () => {
    const { tripId, ownerToken, ownerParticipantId } = await setupTripWithOwner('🇭🇰测试-日期跨锚点');
    const paymentMethodId = await createCashPaymentMethod(ownerToken);
    const wallet = await createWallet(tripId, ownerToken, { paymentMethodId });

    // 建钱包时先有一笔锚点前的消费（不计入），锚点设完之后再改它的日期到锚点后。
    const beforeExpense = await recordExpense(tripId, ownerToken, ownerParticipantId, 2000, 'HKD', BEFORE_ANCHOR, paymentMethodId);
    await setWalletBalance(tripId, ownerToken, wallet.id, 100000, ANCHOR);
    expect(await getWalletBalance(tripId, ownerToken, wallet.id)).toBe(100000);

    // 把这笔消费的日期改到锚点之后：应该开始被扣。
    const patch1 = await expensePatchHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses/${beforeExpense.id}`, 'PATCH', ownerToken, {
        expenseDate: AFTER_ANCHOR,
      }),
      { params: { tripId, expenseId: beforeExpense.id } }
    );
    expect(patch1.status).toBe(200);
    expect(await getWalletBalance(tripId, ownerToken, wallet.id)).toBe(98000);

    // 反方向：把它的日期改回锚点之前，应该停止被扣，恢复原状。
    const patch2 = await expensePatchHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses/${beforeExpense.id}`, 'PATCH', ownerToken, {
        expenseDate: BEFORE_ANCHOR,
      }),
      { params: { tripId, expenseId: beforeExpense.id } }
    );
    expect(patch2.status).toBe(200);
    expect(await getWalletBalance(tripId, ownerToken, wallet.id)).toBe(100000);
  });

  it('⑥编辑消费支付方式：换出这个钱包绑定的支付方式会加回余额，换入会扣', async () => {
    const { tripId, ownerToken, ownerParticipantId } = await setupTripWithOwner('🇭🇰测试-换支付方式');
    const cashMethodId = await createCashPaymentMethod(ownerToken, 'HKD');
    const cardMethodId = await createCashPaymentMethod(ownerToken, 'HKD'); // 名字沿用 helper，只是另一个支付方式 id
    const wallet = await createWallet(tripId, ownerToken, { paymentMethodId: cashMethodId });
    await setWalletBalance(tripId, ownerToken, wallet.id, 100000, ANCHOR);

    const expense = await recordExpense(tripId, ownerToken, ownerParticipantId, 4000, 'HKD', AFTER_ANCHOR, cashMethodId);
    expect(await getWalletBalance(tripId, ownerToken, wallet.id)).toBe(96000);

    // 换出：改绑到另一个支付方式（没有对应的已锚定钱包），这个钱包的余额应该加回来。
    const patchOut = await expensePatchHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses/${expense.id}`, 'PATCH', ownerToken, {
        paymentMethodId: cardMethodId,
      }),
      { params: { tripId, expenseId: expense.id } }
    );
    expect(patchOut.status).toBe(200);
    expect(await getWalletBalance(tripId, ownerToken, wallet.id)).toBe(100000);

    // 换入：改回绑定这个钱包的支付方式，应该重新被扣。
    const patchIn = await expensePatchHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses/${expense.id}`, 'PATCH', ownerToken, {
        paymentMethodId: cashMethodId,
      }),
      { params: { tripId, expenseId: expense.id } }
    );
    expect(patchIn.status).toBe(200);
    expect(await getWalletBalance(tripId, ownerToken, wallet.id)).toBe(96000);
  });

  it('⑦锚点日期起的换汇净额也会被纳入重算范围（收到的换汇会被算作+，转出的会被算作-，删除记录会自动撤销）', async () => {
    const { tripId, ownerToken } = await setupTripWithOwner('🇭🇰测试-换汇净额');
    const cashWallet = await createWallet(tripId, ownerToken, { currency: 'HKD', label: '现金' });
    const bankWallet = await createWallet(tripId, ownerToken, { currency: 'HKD', label: '银行' });
    await setWalletBalance(tripId, ownerToken, cashWallet.id, 100000, ANCHOR);

    // 从 cashWallet 转 20000 到 bankWallet，换汇日期在锚点之后。
    const exchangeRes = await exchangeRecordsPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/exchange-records`, 'POST', ownerToken, {
        fromWalletId: cashWallet.id,
        toWalletId: bankWallet.id,
        fromAmount: 20000,
        toAmount: 20000,
        exchangeDate: AFTER_ANCHOR,
      }),
      { params: { tripId } }
    );
    expect(exchangeRes.status).toBe(201);
    const exchangeRecord = ((await exchangeRes.json()) as any).exchangeRecord as { id: string };

    // cashWallet 已锚定：转出 20000 通过推导公式自动反映，不是靠写入。
    expect(await getWalletBalance(tripId, ownerToken, cashWallet.id)).toBe(80000);
    // bankWallet 没锚定，走旧的累加写入路径，原本行为不变。
    expect(await getWalletBalance(tripId, ownerToken, bankWallet.id)).toBe(20000);

    const deleteRes = await exchangeRecordDeleteHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/exchange-records/${exchangeRecord.id}`, 'DELETE', ownerToken),
      { params: { tripId, exchangeRecordId: exchangeRecord.id } }
    );
    expect(deleteRes.status).toBe(204);
    expect(await getWalletBalance(tripId, ownerToken, cashWallet.id)).toBe(100000);
    expect(await getWalletBalance(tripId, ownerToken, bankWallet.id)).toBe(0);
  });
});
