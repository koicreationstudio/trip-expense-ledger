import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, type Db } from '@/lib/db/client';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';
import { wallets } from '@/lib/db/schema';

/**
 * round72 第三批（余额历史可直接编辑）：PATCH /balance-history/[historyId]。
 *
 * 用没绑支付方式、没有任何关联消费/换汇记录的钱包——`computeWalletDisplayBalance`
 * 这种情况下直接等于锚点原始值（见 lib/domain/wallet-balance.ts 顶部注释），
 * 期望值好算，不用另外造消费数据。
 */

let db: Db;
let SESSION_COOKIE_NAME: string;
let USER_SESSION_COOKIE_NAME: string;
let provisionHandler: typeof import('@/app/api/account/provision/route').POST;
let tripsPostHandler: typeof import('@/app/api/trips/route').POST;
let walletsPostHandler: typeof import('../../../route').POST;
let walletsGetHandler: typeof import('../../../route').GET;
let walletPatchHandler: typeof import('../../route').PATCH;
let balanceHistoryGetHandler: typeof import('../route').GET;
let historyPatchHandler: typeof import('./route').PATCH;

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
  ({ POST: walletsPostHandler, GET: walletsGetHandler } = await import('../../../route'));
  ({ PATCH: walletPatchHandler } = await import('../../route'));
  ({ GET: balanceHistoryGetHandler } = await import('../route'));
  ({ PATCH: historyPatchHandler } = await import('./route'));
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
  const ownerToken = createTripRes.cookies.get(SESSION_COOKIE_NAME)?.value!;
  return { tripId, ownerToken, userToken };
}

async function createWallet(tripId: string, ownerToken: string) {
  const res = await walletsPostHandler(
    jsonRequest(`http://localhost/api/trips/${tripId}/wallets`, 'POST', ownerToken, {
      label: '现金',
      currency: 'HKD',
      emoji: '💵',
      initialBalance: 0,
    }),
    { params: { tripId } }
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as any).wallet as { id: string };
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
}

async function getRawWallet(walletId: string) {
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
    originalAmount: number | null;
    originalEffectiveDate: string | null;
    displayBalanceBefore: number;
    displayBalanceAfter: number;
  }>;
}

function editHistory(
  tripId: string,
  ownerToken: string,
  walletId: string,
  historyId: string,
  amount: number,
  effectiveDate: string
) {
  return historyPatchHandler(
    jsonRequest(
      `http://localhost/api/trips/${tripId}/wallets/${walletId}/balance-history/${historyId}`,
      'PATCH',
      ownerToken,
      { amount, effectiveDate }
    ),
    { params: { tripId, walletId, historyId } }
  );
}

const ANCHOR_1 = '2026-09-20T00:00:00.000Z';
const ANCHOR_2 = '2026-09-24T00:00:00.000Z';

describe('PATCH /balance-history/[historyId]：直接编辑一条历史记录', () => {
  it('编辑「当前生效」那条：钱包 currentBalance/balanceUpdatedAt 真的变了，displayBalanceAfter 数字对', async () => {
    const { tripId, ownerToken } = await setupTripWithOwner('🇭🇰测试-编辑当前生效');
    const wallet = await createWallet(tripId, ownerToken);
    await setWalletBalance(tripId, ownerToken, wallet.id, 100000, ANCHOR_1);

    const history = await getHistory(tripId, ownerToken, wallet.id);
    expect(history).toHaveLength(1);
    const entryId = history[0]!.id;

    const newAmount = 90000;
    const newDate = '2026-09-21T00:00:00.000Z';
    const res = await editHistory(tripId, ownerToken, wallet.id, entryId, newAmount, newDate);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(body.isCurrent).toBe(true);
    expect(body.displayBalanceBefore).toBe(100000); // 编辑前，没有任何消费/换汇，等于旧锚点本身
    expect(body.displayBalanceAfter).toBe(90000); // 编辑后，等于新锚点本身
    expect(body.wallet.currentBalance).toBe(90000);
    expect(new Date(body.wallet.balanceUpdatedAt).toISOString()).toBe(newDate);

    // 钱包表真的被改了（不是只在响应体里显示，落库也要对）。
    const rawWallet = await getRawWallet(wallet.id);
    expect(rawWallet.currentBalance).toBe(90000);
    expect(rawWallet.balanceUpdatedAt?.toISOString()).toBe(newDate);

    // 历史记录本身：amount/effectiveDate 更新，originalAmount/originalEffectiveDate
    // 是这次编辑之前的旧值（第一次编辑，之前是 null）。
    const updatedHistory = await getHistory(tripId, ownerToken, wallet.id);
    const updatedEntry = updatedHistory.find((h) => h.id === entryId)!;
    expect(updatedEntry.amount).toBe(newAmount);
    expect(new Date(updatedEntry.effectiveDate).toISOString()).toBe(newDate);
    expect(updatedEntry.originalAmount).toBe(100000);
    expect(new Date(updatedEntry.originalEffectiveDate!).toISOString()).toBe(ANCHOR_1);
    // 这条记录自己的 displayBalanceAfter 字段也跟着更新成新算出的值。
    expect(updatedEntry.displayBalanceAfter).toBe(90000);
  });

  it('编辑「已被覆盖的历史」条目：钱包完全没变，只改这条记录本身', async () => {
    const { tripId, ownerToken } = await setupTripWithOwner('🇭🇰测试-编辑历史条目');
    const wallet = await createWallet(tripId, ownerToken);
    await setWalletBalance(tripId, ownerToken, wallet.id, 100000, ANCHOR_1);
    await setWalletBalance(tripId, ownerToken, wallet.id, 200000, ANCHOR_2);

    const history = await getHistory(tripId, ownerToken, wallet.id);
    expect(history).toHaveLength(2);
    const currentEntry = history[0]!; // changedAt 最新
    const oldEntry = history[1]!; // 已被覆盖

    const walletBefore = await getRawWallet(wallet.id);

    const newAmount = 150000;
    const newDate = '2026-09-19T00:00:00.000Z';
    const res = await editHistory(tripId, ownerToken, wallet.id, oldEntry.id, newAmount, newDate);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(body.isCurrent).toBe(false);
    // 不该返回 wallet/displayBalanceBefore/displayBalanceAfter 这几个字段（这次编辑
    // 跟钱包当前余额完全无关，不需要这些数字）。
    expect(body.wallet).toBeUndefined();
    expect(body.displayBalanceBefore).toBeUndefined();
    expect(body.displayBalanceAfter).toBeUndefined();

    // 钱包完全没变（currentBalance/balanceUpdatedAt 还是第二次设置的那组值）。
    const walletAfter = await getRawWallet(wallet.id);
    expect(walletAfter.currentBalance).toBe(walletBefore.currentBalance);
    expect(walletAfter.balanceUpdatedAt?.toISOString()).toBe(walletBefore.balanceUpdatedAt?.toISOString());
    expect(walletAfter.currentBalance).toBe(200000);

    // 这条历史记录自己确实改了。
    const updatedHistory = await getHistory(tripId, ownerToken, wallet.id);
    const updatedOldEntry = updatedHistory.find((h) => h.id === oldEntry.id)!;
    expect(updatedOldEntry.amount).toBe(newAmount);
    expect(new Date(updatedOldEntry.effectiveDate).toISOString()).toBe(newDate);
    expect(updatedOldEntry.originalAmount).toBe(100000);
    expect(new Date(updatedOldEntry.originalEffectiveDate!).toISOString()).toBe(ANCHOR_1);
    // "当前生效"那条完全没被这次编辑动到。
    const updatedCurrentEntry = updatedHistory.find((h) => h.id === currentEntry.id)!;
    expect(updatedCurrentEntry.amount).toBe(currentEntry.amount);
    expect(updatedCurrentEntry.originalAmount).toBeNull();
  });

  it('第一次编辑后 originalAmount 非 null 且等于编辑前的值；第二次编辑同一条后 originalAmount 还是第一次编辑前的值（不是第二次编辑前的中间值）', async () => {
    const { tripId, ownerToken } = await setupTripWithOwner('🇭🇰测试-连续两次编辑');
    const wallet = await createWallet(tripId, ownerToken);
    await setWalletBalance(tripId, ownerToken, wallet.id, 100000, ANCHOR_1);
    await setWalletBalance(tripId, ownerToken, wallet.id, 200000, ANCHOR_2); // 让第一条不再是当前生效

    const history = await getHistory(tripId, ownerToken, wallet.id);
    const oldEntry = history.find((h) => h.amount === 100000)!;

    // 第一次编辑：100000 -> 120000
    await editHistory(tripId, ownerToken, wallet.id, oldEntry.id, 120000, '2026-09-19T00:00:00.000Z');
    const afterFirst = (await getHistory(tripId, ownerToken, wallet.id)).find((h) => h.id === oldEntry.id)!;
    expect(afterFirst.amount).toBe(120000);
    expect(afterFirst.originalAmount).toBe(100000);
    expect(new Date(afterFirst.originalEffectiveDate!).toISOString()).toBe(ANCHOR_1);

    // 第二次编辑同一条：120000 -> 150000。originalAmount 不该变成第一次编辑后的
    // 中间值 120000，应该维持第一次编辑前捕获的 100000。
    await editHistory(tripId, ownerToken, wallet.id, oldEntry.id, 150000, '2026-09-18T00:00:00.000Z');
    const afterSecond = (await getHistory(tripId, ownerToken, wallet.id)).find((h) => h.id === oldEntry.id)!;
    expect(afterSecond.amount).toBe(150000);
    expect(afterSecond.originalAmount).toBe(100000);
    expect(afterSecond.originalAmount).not.toBe(120000);
    expect(new Date(afterSecond.originalEffectiveDate!).toISOString()).toBe(ANCHOR_1);
  });

  it('权限：这条历史记录不属于当前用户的钱包时 404', async () => {
    const { tripId, ownerToken } = await setupTripWithOwner('🇭🇰测试-历史权限');
    const wallet = await createWallet(tripId, ownerToken);
    await setWalletBalance(tripId, ownerToken, wallet.id, 100000, ANCHOR_1);
    const history = await getHistory(tripId, ownerToken, wallet.id);
    const entryId = history[0]!.id;

    // 另一趟行程的 owner 想编辑这条历史（tripId 用的还是第一趟行程的，identity 却是
    // 另一趟行程的 owner）——assertSameTrip 会先挡下来，跟这个项目别处的权限测试
    // 同一套判断口径。
    const { ownerToken: otherOwnerToken } = await setupTripWithOwner('🇭🇰测试-历史权限-别人的行程');
    const res = await editHistory(tripId, otherOwnerToken, wallet.id, entryId, 1, ANCHOR_1);
    expect(res.status).toBe(404);

    // 保险起见也确认一下：历史记录本身没有被这次失败请求改动。
    const stillOriginal = (await getHistory(tripId, ownerToken, wallet.id)).find((h) => h.id === entryId)!;
    expect(stillOriginal.amount).toBe(100000);
  });
});
