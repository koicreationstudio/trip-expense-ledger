import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';

/**
 * round72 第三批（余额历史可直接编辑）：POST /balance-history/[historyId]/preview。
 * 纯算"编辑之后会怎样"，不写库——跟 ../route.ts（真正落库的 PATCH）是表亲关系，
 * 这份测试重点验证"预览端点算出来的数字跟真实编辑一致，且预览本身不改任何东西"。
 */

let SESSION_COOKIE_NAME: string;
let USER_SESSION_COOKIE_NAME: string;
let provisionHandler: typeof import('@/app/api/account/provision/route').POST;
let tripsPostHandler: typeof import('@/app/api/trips/route').POST;
let walletsPostHandler: typeof import('../../../../route').POST;
let walletPatchHandler: typeof import('../../../route').PATCH;
let balanceHistoryGetHandler: typeof import('../../route').GET;
let historyPatchHandler: typeof import('../route').PATCH;
let previewHandler: typeof import('./route').POST;

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
  ({ POST: previewHandler } = await import('./route'));
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
  return body.history as Array<{ id: string; amount: number }>;
}

function preview(
  tripId: string,
  ownerToken: string,
  walletId: string,
  historyId: string,
  newAmount: number,
  newEffectiveDate: string
) {
  return previewHandler(
    jsonRequest(
      `http://localhost/api/trips/${tripId}/wallets/${walletId}/balance-history/${historyId}/preview`,
      'POST',
      ownerToken,
      { newAmount, newEffectiveDate }
    ),
    { params: { tripId, walletId, historyId } }
  );
}

const ANCHOR_1 = '2026-09-20T00:00:00.000Z';
const ANCHOR_2 = '2026-09-24T00:00:00.000Z';

describe('POST /balance-history/[historyId]/preview：纯算不写库', () => {
  it('预览「当前生效」条目：返回 isCurrent=true + 改前/改后现余额，跟真实 PATCH 编辑算出来的数字一致', async () => {
    const { tripId, ownerToken } = await setupTripWithOwner('🇭🇰测试-预览当前生效');
    const wallet = await createWallet(tripId, ownerToken);
    await setWalletBalance(tripId, ownerToken, wallet.id, 100000, ANCHOR_1);
    const history = await getHistory(tripId, ownerToken, wallet.id);
    const entryId = history[0]!.id;

    const newAmount = 88000;
    const newDate = '2026-09-21T00:00:00.000Z';
    const res = await preview(tripId, ownerToken, wallet.id, entryId, newAmount, newDate);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(body.isCurrent).toBe(true);
    expect(body.displayBalanceBefore).toBe(100000);
    expect(body.displayBalanceAfter).toBe(88000);

    // 预览不写库：钱包和历史记录都不该被这次 POST 改动。
    const stillHistory = await getHistory(tripId, ownerToken, wallet.id);
    expect(stillHistory[0]!.amount).toBe(100000);
  });

  it('预览「已被覆盖的历史」条目：只返回 isCurrent=false，不带余额数字', async () => {
    const { tripId, ownerToken } = await setupTripWithOwner('🇭🇰测试-预览历史条目');
    const wallet = await createWallet(tripId, ownerToken);
    await setWalletBalance(tripId, ownerToken, wallet.id, 100000, ANCHOR_1);
    await setWalletBalance(tripId, ownerToken, wallet.id, 200000, ANCHOR_2);
    const history = await getHistory(tripId, ownerToken, wallet.id);
    const oldEntry = history.find((h) => h.amount === 100000)!;

    const res = await preview(tripId, ownerToken, wallet.id, oldEntry.id, 999, '2026-01-01T00:00:00.000Z');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(body.isCurrent).toBe(false);
    expect(body.displayBalanceBefore).toBeUndefined();
    expect(body.displayBalanceAfter).toBeUndefined();
  });

  it('预览端点算出的数字，跟真的走 PATCH 编辑同一条「当前生效」记录之后落库的数字完全一致', async () => {
    const { tripId, ownerToken } = await setupTripWithOwner('🇭🇰测试-预览一致性');
    const wallet = await createWallet(tripId, ownerToken);
    await setWalletBalance(tripId, ownerToken, wallet.id, 100000, ANCHOR_1);
    const history = await getHistory(tripId, ownerToken, wallet.id);
    const entryId = history[0]!.id;

    const newAmount = 77000;
    const newDate = '2026-09-22T00:00:00.000Z';
    const previewRes = await preview(tripId, ownerToken, wallet.id, entryId, newAmount, newDate);
    const previewBody = (await previewRes.json()) as any;

    const patchRes = await historyPatchHandler(
      jsonRequest(
        `http://localhost/api/trips/${tripId}/wallets/${wallet.id}/balance-history/${entryId}`,
        'PATCH',
        ownerToken,
        { amount: newAmount, effectiveDate: newDate }
      ),
      { params: { tripId, walletId: wallet.id, historyId: entryId } }
    );
    const patchBody = (await patchRes.json()) as any;

    expect(previewBody.displayBalanceBefore).toBe(patchBody.displayBalanceBefore);
    expect(previewBody.displayBalanceAfter).toBe(patchBody.displayBalanceAfter);
  });

  it('权限：这条历史记录不属于当前用户的钱包时 404', async () => {
    const { tripId, ownerToken } = await setupTripWithOwner('🇭🇰测试-预览权限');
    const wallet = await createWallet(tripId, ownerToken);
    await setWalletBalance(tripId, ownerToken, wallet.id, 100000, ANCHOR_1);
    const history = await getHistory(tripId, ownerToken, wallet.id);
    const entryId = history[0]!.id;

    const { ownerToken: otherOwnerToken } = await setupTripWithOwner('🇭🇰测试-预览权限-别人的行程');
    const res = await preview(tripId, otherOwnerToken, wallet.id, entryId, 1, ANCHOR_1);
    expect(res.status).toBe(404);
  });
});
