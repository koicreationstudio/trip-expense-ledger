import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';

/**
 * round72 第三批（余额历史可直接编辑）：POST /balance-history/[historyId]/revert。
 * 「还原成原始值」——不带 body，目标值直接来自这条记录自己存的
 * originalAmount/originalEffectiveDate；从没被编辑过（originalAmount 是 null）
 * 时没有原始值可还原，返回 400。
 */

let SESSION_COOKIE_NAME: string;
let USER_SESSION_COOKIE_NAME: string;
let provisionHandler: typeof import('@/app/api/account/provision/route').POST;
let tripsPostHandler: typeof import('@/app/api/trips/route').POST;
let walletsPostHandler: typeof import('../../../../route').POST;
let walletPatchHandler: typeof import('../../../route').PATCH;
let balanceHistoryGetHandler: typeof import('../../route').GET;
let historyPatchHandler: typeof import('../route').PATCH;
let revertHandler: typeof import('./route').POST;

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

  ({ SESSION_COOKIE_NAME } = await import('@/lib/auth/session'));
  ({ USER_SESSION_COOKIE_NAME } = await import('@/lib/auth/user-session'));
  ({ POST: provisionHandler } = await import('@/app/api/account/provision/route'));
  ({ POST: tripsPostHandler } = await import('@/app/api/trips/route'));
  ({ POST: walletsPostHandler } = await import('../../../../route'));
  ({ PATCH: walletPatchHandler } = await import('../../../route'));
  ({ GET: balanceHistoryGetHandler } = await import('../../route'));
  ({ PATCH: historyPatchHandler } = await import('../route'));
  ({ POST: revertHandler } = await import('./route'));
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

function revert(tripId: string, ownerToken: string, walletId: string, historyId: string) {
  return revertHandler(
    jsonRequest(
      `http://localhost/api/trips/${tripId}/wallets/${walletId}/balance-history/${historyId}/revert`,
      'POST',
      ownerToken
    ),
    { params: { tripId, walletId, historyId } }
  );
}

const ANCHOR_1 = '2026-09-20T00:00:00.000Z';
const ANCHOR_2 = '2026-09-24T00:00:00.000Z';

describe('POST /balance-history/[historyId]/revert：还原成原始值', () => {
  it('从没被编辑过（originalAmount 为 null）时返回 400 nothing_to_revert', async () => {
    const { tripId, ownerToken } = await setupTripWithOwner('🇭🇰测试-还原400');
    const wallet = await createWallet(tripId, ownerToken);
    await setWalletBalance(tripId, ownerToken, wallet.id, 100000, ANCHOR_1);
    const history = await getHistory(tripId, ownerToken, wallet.id);
    const entryId = history[0]!.id;
    expect(history[0]!.originalAmount).toBeNull();

    const res = await revert(tripId, ownerToken, wallet.id, entryId);
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe('nothing_to_revert');
  });

  it('还原「当前生效」条目：amount/effectiveDate 变回原始值，originalAmount/originalEffectiveDate 清空成 null，钱包余额也跟着变回去', async () => {
    const { tripId, ownerToken } = await setupTripWithOwner('🇭🇰测试-还原当前生效');
    const wallet = await createWallet(tripId, ownerToken);
    await setWalletBalance(tripId, ownerToken, wallet.id, 100000, ANCHOR_1);
    const history = await getHistory(tripId, ownerToken, wallet.id);
    const entryId = history[0]!.id;

    // 先编辑一次，制造"已更正"状态。
    await editHistory(tripId, ownerToken, wallet.id, entryId, 90000, '2026-09-21T00:00:00.000Z');
    const afterEdit = (await getHistory(tripId, ownerToken, wallet.id)).find((h) => h.id === entryId)!;
    expect(afterEdit.amount).toBe(90000);
    expect(afterEdit.originalAmount).toBe(100000);

    const res = await revert(tripId, ownerToken, wallet.id, entryId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.isCurrent).toBe(true);
    expect(body.wallet.currentBalance).toBe(100000);
    expect(new Date(body.wallet.balanceUpdatedAt).toISOString()).toBe(ANCHOR_1);

    const afterRevert = (await getHistory(tripId, ownerToken, wallet.id)).find((h) => h.id === entryId)!;
    expect(afterRevert.amount).toBe(100000);
    expect(new Date(afterRevert.effectiveDate).toISOString()).toBe(ANCHOR_1);
    expect(afterRevert.originalAmount).toBeNull();
    expect(afterRevert.originalEffectiveDate).toBeNull();
  });

  it('还原「已被覆盖的历史」条目：只改这条记录本身，钱包完全不受影响', async () => {
    const { tripId, ownerToken } = await setupTripWithOwner('🇭🇰测试-还原历史条目');
    const wallet = await createWallet(tripId, ownerToken);
    await setWalletBalance(tripId, ownerToken, wallet.id, 100000, ANCHOR_1);
    await setWalletBalance(tripId, ownerToken, wallet.id, 200000, ANCHOR_2);
    const history = await getHistory(tripId, ownerToken, wallet.id);
    const oldEntry = history.find((h) => h.amount === 100000)!;

    await editHistory(tripId, ownerToken, wallet.id, oldEntry.id, 50000, '2026-09-18T00:00:00.000Z');

    const res = await revert(tripId, ownerToken, wallet.id, oldEntry.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.isCurrent).toBe(false);
    expect(body.wallet).toBeUndefined();

    const afterRevert = (await getHistory(tripId, ownerToken, wallet.id)).find((h) => h.id === oldEntry.id)!;
    expect(afterRevert.amount).toBe(100000);
    expect(new Date(afterRevert.effectiveDate).toISOString()).toBe(ANCHOR_1);
    expect(afterRevert.originalAmount).toBeNull();
    expect(afterRevert.originalEffectiveDate).toBeNull();

    // 钱包（当前生效那条：200000@ANCHOR_2）完全没受这次还原影响。
    const currentEntry = (await getHistory(tripId, ownerToken, wallet.id)).find((h) => h.amount === 200000)!;
    expect(currentEntry.originalAmount).toBeNull();
  });

  it('权限：这条历史记录不属于当前用户的钱包时 404', async () => {
    const { tripId, ownerToken } = await setupTripWithOwner('🇭🇰测试-还原权限');
    const wallet = await createWallet(tripId, ownerToken);
    await setWalletBalance(tripId, ownerToken, wallet.id, 100000, ANCHOR_1);
    const history = await getHistory(tripId, ownerToken, wallet.id);
    const entryId = history[0]!.id;
    await editHistory(tripId, ownerToken, wallet.id, entryId, 90000, '2026-09-21T00:00:00.000Z');

    const { ownerToken: otherOwnerToken } = await setupTripWithOwner('🇭🇰测试-还原权限-别人的行程');
    const res = await revert(tripId, otherOwnerToken, wallet.id, entryId);
    expect(res.status).toBe(404);
  });
});
