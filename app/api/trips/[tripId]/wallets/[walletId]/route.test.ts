import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, type Db } from '@/lib/db/client';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';
import { wallets } from '@/lib/db/schema';
import { computeWalletDisplayBalance, withHypotheticalAnchor } from '@/lib/domain/wallet-balance';

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
let balancePreviewPostHandler: typeof import('./balance-preview/route').POST;
let balanceHistoryGetHandler: typeof import('./balance-history/route').GET;

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
  ({ POST: balancePreviewPostHandler } = await import('./balance-preview/route'));
  ({ GET: balanceHistoryGetHandler } = await import('./balance-history/route'));
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

/**
 * 第七十二轮新增（防覆盖确认流程 + wallet_balance_history 历史记录）：
 *
 * ①每次带 `currentBalance` 的 PATCH（=一次"设置当前余额"动作）都要在
 * `wallet_balance_history` 追加一条，字段值（新锚点/改前锚点/改前改后现余额/
 * 操作者）都要对。②这个钱包"从未设置过锚点"时首次设置，`prevAmount`/
 * `prevEffectiveDate` 必须是 null（代表"改前从未设置"），不能因为没有锚点就
 * 整条跳过不记，`displayBalanceBefore` 用"未锚定模式下按累加值算出的现余额"。
 * ③确认页（balance-preview 端点）显示的"改前/改后现余额"跟直接拿同一个
 * `computeWalletDisplayBalance` 喂旧锚点/新锚点两次调用算出来的数字必须一致，
 * 不是另外发明一套算法。④PATCH 请求带了 `currentBalance` 却不带
 * `balanceUpdatedAt`（或反过来）要被 400 挡下来——这是防覆盖确认流程的最后一道
 * 后端防线，前端表单"生效日期不预填、必须选"那条校验已经在
 * payment-methods-manager.test.tsx 里覆盖过。
 */
describe('设置当前余额：防覆盖确认流程 + wallet_balance_history 历史记录', () => {
  async function loadRawWallet(walletId: string) {
    const row = await db.query.wallets.findFirst({ where: eq(wallets.id, walletId) });
    if (!row) throw new Error('wallet not found');
    return row;
  }

  async function getHistory(tripId: string, ownerToken: string, walletId: string) {
    const res = await balanceHistoryGetHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/wallets/${walletId}/balance-history`, 'GET', ownerToken),
      { params: { tripId, walletId } }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    return body.history as Array<{
      id: string;
      amount: number;
      effectiveDate: string;
      changedByParticipantId: string;
      changedAt: string;
      prevAmount: number | null;
      prevEffectiveDate: string | null;
      displayBalanceBefore: number;
      displayBalanceAfter: number;
    }>;
  }

  it('①保存新锚点会追加一条历史记录，字段值（新锚点/改前锚点/改前改后现余额/操作者）都正确', async () => {
    const { tripId, ownerToken, ownerParticipantId } = await setupTripWithOwner('🇭🇰测试-历史记录①');
    const paymentMethodId = await createCashPaymentMethod(ownerToken);
    const wallet = await createWallet(tripId, ownerToken, { paymentMethodId });

    // 第一次设置：改前从未设置过，历史第一条 prevAmount/prevEffectiveDate 该是 null
    // （这条本身就是②要覆盖的场景，这里只是顺带走一次，重点验证在下面第二次设置）。
    await setWalletBalance(tripId, ownerToken, wallet.id, 100000, ANCHOR);

    // 锚点之后记一笔消费，让"改前现余额"跟"锚点原始值"不一样，历史记录要能分清这两者。
    await recordExpense(tripId, ownerToken, ownerParticipantId, 5000, 'HKD', AFTER_ANCHOR, paymentMethodId);
    expect(await getWalletBalance(tripId, ownerToken, wallet.id)).toBe(95000);

    // 第二次设置：这次改前锚点是 100000@ANCHOR，改前现余额是 95000（已经扣了那笔消费）。
    const secondAnchorDate = '2026-09-20T00:00:00.000Z';
    await setWalletBalance(tripId, ownerToken, wallet.id, 200000, secondAnchorDate);

    const history = await getHistory(tripId, ownerToken, wallet.id);
    expect(history).toHaveLength(2);
    const latest = history[0]!; // 倒序：最新的在前
    const first = history[1]!;

    // 最新一条（第二次设置）：新锚点是 200000@secondAnchorDate，改前锚点是
    // 100000@ANCHOR，改前现余额 95000，改后现余额就是新锚点本身（刚设置那一刻，
    // secondAnchorDate 之后还没有任何消费/换汇）。
    expect(latest.amount).toBe(200000);
    expect(new Date(latest.effectiveDate).toISOString()).toBe(secondAnchorDate);
    expect(latest.changedByParticipantId).toBe(ownerParticipantId);
    expect(latest.prevAmount).toBe(100000);
    expect(new Date(latest.prevEffectiveDate!).toISOString()).toBe(ANCHOR);
    expect(latest.displayBalanceBefore).toBe(95000);
    expect(latest.displayBalanceAfter).toBe(200000);

    // 第一条（第一次设置）：改前从未设置过，prevAmount/prevEffectiveDate 是 null；
    // 改前现余额走"未锚定模式"（这个钱包刚建好，累加值就是 0）。
    expect(first.amount).toBe(100000);
    expect(new Date(first.effectiveDate).toISOString()).toBe(ANCHOR);
    expect(first.prevAmount).toBeNull();
    expect(first.prevEffectiveDate).toBeNull();
    expect(first.displayBalanceBefore).toBe(0);
    expect(first.displayBalanceAfter).toBe(100000);
  });

  it('②"从未设置过"首次设置：prevAmount/prevEffectiveDate 是 null，displayBalanceBefore 用未锚定模式的累加值', async () => {
    const { tripId, ownerToken, ownerParticipantId } = await setupTripWithOwner('🇭🇰测试-历史记录②');
    const paymentMethodId = await createCashPaymentMethod(ownerToken);
    // 不在建钱包时绑支付方式的历史回溯路径上纠结，直接建一个没绑支付方式的钱包，
    // 靠换汇走"未锚定模式"下的累加写入，制造一个非零的累加值。
    const wallet = await createWallet(tripId, ownerToken, { currency: 'HKD' });
    const otherWallet = await createWallet(tripId, ownerToken, { currency: 'HKD', label: '另一个钱包' });

    // 从 otherWallet 转 30000 到这个从未设置过的钱包——未锚定模式下这是直接累加写入
    // currentBalance（lib/domain/wallet-balance.ts 顶部注释"旧的可变累加字段"那段）。
    const exchangeRes = await exchangeRecordsPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/exchange-records`, 'POST', ownerToken, {
        fromWalletId: otherWallet.id,
        toWalletId: wallet.id,
        fromAmount: 30000,
        toAmount: 30000,
        exchangeDate: BEFORE_ANCHOR,
      }),
      { params: { tripId } }
    );
    expect(exchangeRes.status).toBe(201);
    expect(await getWalletBalance(tripId, ownerToken, wallet.id)).toBe(30000);

    // 首次设置当前余额：改前从未设置过锚点。
    await setWalletBalance(tripId, ownerToken, wallet.id, 500000, ANCHOR);

    const history = await getHistory(tripId, ownerToken, wallet.id);
    expect(history).toHaveLength(1);
    const entry = history[0]!;
    expect(entry.prevAmount).toBeNull();
    expect(entry.prevEffectiveDate).toBeNull();
    // 改前现余额 = 未锚定模式下的累加值（30000），不是 0、也不是凭空跳过这条记录。
    expect(entry.displayBalanceBefore).toBe(30000);
    expect(entry.displayBalanceAfter).toBe(500000);
    expect(entry.amount).toBe(500000);
    expect(entry.changedByParticipantId).toBe(ownerParticipantId);

    void paymentMethodId; // 这条测试没用到，留着签名一致方便复用 helper
  });

  it('③确认页(balance-preview)显示的改前/改后现余额，跟直接调用 computeWalletDisplayBalance 分别喂旧/新锚点算出来的数字一致', async () => {
    const { tripId, ownerToken, ownerParticipantId } = await setupTripWithOwner('🇭🇰测试-历史记录③');
    const paymentMethodId = await createCashPaymentMethod(ownerToken);
    const wallet = await createWallet(tripId, ownerToken, { paymentMethodId });
    await setWalletBalance(tripId, ownerToken, wallet.id, 100000, ANCHOR);
    await recordExpense(tripId, ownerToken, ownerParticipantId, 4000, 'HKD', AFTER_ANCHOR, paymentMethodId);

    const newAmount = 250000;
    const newDate = '2026-09-22T00:00:00.000Z';

    // 「真相」：直接调用同一个 computeWalletDisplayBalance，先喂 DB 里现在的旧锚点，
    // 再喂 withHypotheticalAnchor 构造出来的新锚点。
    const rawWallet = await loadRawWallet(wallet.id);
    const expectedBefore = await computeWalletDisplayBalance(db, rawWallet);
    const expectedAfter = await computeWalletDisplayBalance(
      db,
      withHypotheticalAnchor(rawWallet, newAmount, new Date(newDate))
    );

    // 「确认页看到的」：调预览端点。
    const previewRes = await balancePreviewPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/wallets/${wallet.id}/balance-preview`, 'POST', ownerToken, {
        newCurrentBalance: newAmount,
        newBalanceUpdatedAt: newDate,
      }),
      { params: { tripId, walletId: wallet.id } }
    );
    expect(previewRes.status).toBe(200);
    const previewBody = (await previewRes.json()) as any;

    expect(previewBody.displayBalanceBefore).toBe(expectedBefore);
    expect(previewBody.displayBalanceAfter).toBe(expectedAfter);
    // 两个数字本身也要有意义（不是巧合的 0===0）：改前有扣掉那笔消费，改后就是新锚点本身。
    expect(expectedBefore).toBe(96000);
    expect(expectedAfter).toBe(250000);

    // 预览端点不写库：这次 POST 之后钱包的锚点应该还是原来那个，没有被悄悄改掉。
    const stillOld = await loadRawWallet(wallet.id);
    expect(stillOld.currentBalance).toBe(100000);
    expect(stillOld.balanceUpdatedAt?.toISOString()).toBe(ANCHOR);
  });

  it('④PATCH 带了 currentBalance 却不带 balanceUpdatedAt（或反过来）要被 400 挡下来——防覆盖确认流程的后端最后一道防线', async () => {
    const { tripId, ownerToken } = await setupTripWithOwner('🇭🇰测试-历史记录④');
    const wallet = await createWallet(tripId, ownerToken, { currency: 'HKD' });

    const onlyAmount = await walletPatchHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/wallets/${wallet.id}`, 'PATCH', ownerToken, {
        currentBalance: 100000,
      }),
      { params: { tripId, walletId: wallet.id } }
    );
    expect(onlyAmount.status).toBe(400);

    const onlyDate = await walletPatchHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/wallets/${wallet.id}`, 'PATCH', ownerToken, {
        balanceUpdatedAt: ANCHOR,
      }),
      { params: { tripId, walletId: wallet.id } }
    );
    expect(onlyDate.status).toBe(400);

    // 两个字段都不带（比如只改名字）应该照常放行，不受这条校验影响。
    const renameOnly = await walletPatchHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/wallets/${wallet.id}`, 'PATCH', ownerToken, {
        label: '改个名字',
      }),
      { params: { tripId, walletId: wallet.id } }
    );
    expect(renameOnly.status).toBe(200);

    // 这几次都不该产生历史记录（都不是真的"设置当前余额"）。
    const history = await getHistory(tripId, ownerToken, wallet.id);
    expect(history).toHaveLength(0);
  });
});
