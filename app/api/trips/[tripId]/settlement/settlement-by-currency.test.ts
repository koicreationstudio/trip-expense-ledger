import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, type Db } from '@/lib/db/client';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';
import { expenseSplits } from '@/lib/db/schema';

/**
 * "结算按币种拆开显示"（2026-09-26）端到端集成测试：从真实 API 请求（记两笔不同
 * 币种的消费 → 落库时精确算好 shareAmountOriginal → 结算 GET 按币种拆行返回 →
 * 按币种分别确认收款）走一遍，不只是单测纯函数，确认整条链路真的接上了。
 */
let db: Db;
let SESSION_COOKIE_NAME: string;
let USER_SESSION_COOKIE_NAME: string;
let provisionHandler: typeof import('@/app/api/account/provision/route').POST;
let tripsPostHandler: typeof import('@/app/api/trips/route').POST;
let expensesPostHandler: typeof import('../expenses/route').POST;
let settlementGetHandler: typeof import('./route').GET;
let confirmPostHandler: typeof import('./confirmations/route').POST;
let confirmDeleteHandler: typeof import('./confirmations/route').DELETE;
let loansPostHandler: typeof import('../loans/route').POST;
let repaymentsPostHandler: typeof import('../loans/[loanId]/repayments/route').POST;

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
  ({ POST: expensesPostHandler } = await import('../expenses/route'));
  ({ GET: settlementGetHandler } = await import('./route'));
  ({ POST: confirmPostHandler, DELETE: confirmDeleteHandler } = await import('./confirmations/route'));
  ({ POST: loansPostHandler } = await import('../loans/route'));
  ({ POST: repaymentsPostHandler } = await import('../loans/[loanId]/repayments/route'));
});

afterAll(async () => {
  await teardownTestDb();
});

describe('结算按币种拆开显示：端到端', () => {
  it('两笔不同币种的消费，落库时精确算好 shareAmountOriginal，结算 GET 按币种拆成两行；按币种分别确认收款互不影响', async () => {
    const provisionRes = await provisionHandler(
      jsonRequest('http://localhost/api/account/provision', 'POST', undefined)
    );
    const userToken = provisionRes.cookies.get(USER_SESSION_COOKIE_NAME)?.value!;
    const createTripRes = await tripsPostHandler(
      jsonRequest(
        'http://localhost/api/trips',
        'POST',
        undefined,
        { name: '结算按币种测试行程', baseCurrency: 'HKD', ownerDisplayName: 'remy', participantNames: ['htoo'] },
        userToken
      )
    );
    expect(createTripRes.status).toBe(201);
    const tripBody = (await createTripRes.json()) as any;
    const tripId: string = tripBody.trip.id;
    const remyToken = createTripRes.cookies.get(SESSION_COOKIE_NAME)?.value!;
    const remyId: string = tripBody.trip.ownerParticipantId;
    const htooId: string = tripBody.participants.find((p: any) => p.displayName === 'htoo').id;

    // HKD 100.00：remy 代垫，两人平分——htoo 欠 remy 50.00 HKD。
    const hkdExpenseRes = await expensesPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses`, 'POST', remyToken, {
        payerParticipantId: remyId,
        amount: 10000,
        currency: 'HKD',
        category: '🍜 餐饮',
        expenseDate: new Date().toISOString(),
      }),
      { params: { tripId } }
    );
    expect(hkdExpenseRes.status).toBe(201);

    // MYR 333（本位币约 172，按这个假设汇率），两人平分——htoo 也欠 remy 一笔 MYR。
    const myrExpenseRes = await expensesPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses`, 'POST', remyToken, {
        payerParticipantId: remyId,
        amount: 333,
        currency: 'MYR',
        fxRateUsed: 172 / 333,
        category: '🛍️ 购物',
        expenseDate: new Date().toISOString(),
      }),
      { params: { tripId } }
    );
    expect(myrExpenseRes.status).toBe(201);
    const myrExpenseId: string = ((await myrExpenseRes.json()) as any).expense.id;

    // 落库校验：shareAmountOriginal 精确算好了，两份分摊总和严格等于 333（不丢钱），
    // 不是默认值 0。
    const myrSplitRows = await db.select().from(expenseSplits).where(eq(expenseSplits.expenseId, myrExpenseId));
    expect(myrSplitRows).toHaveLength(2);
    const totalOriginal = myrSplitRows.reduce((sum, r) => sum + r.shareAmountOriginal, 0);
    expect(totalOriginal).toBe(333);
    expect(myrSplitRows.every((r) => r.shareAmountOriginal > 0)).toBe(true); // 不是留在默认值 0

    // 结算 GET：按币种拆成两行，同一对 from/to 出现两次，各自带自己的 currency。
    const settlementRes = await settlementGetHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/settlement`, 'GET', remyToken),
      { params: { tripId } }
    );
    expect(settlementRes.status).toBe(200);
    const settlementBody = (await settlementRes.json()) as any;
    const htooToRemyTransfers = settlementBody.transfers.filter(
      (t: any) => t.fromParticipantId === htooId && t.toParticipantId === remyId
    );
    expect(htooToRemyTransfers.map((t: any) => t.currency).sort()).toEqual(['HKD', 'MYR']);
    const hkdTransfer = htooToRemyTransfers.find((t: any) => t.currency === 'HKD');
    expect(hkdTransfer.amountBaseCurrency).toBe(5000); // HK$50.00

    // htoo（收款方以外的人）不能确认——权限判断不受这次改动影响，仍然只有收款方
    // 本人（remy）能确认。这里用 remy 的 token 确认 HKD 这一笔。
    const confirmHkdRes = await confirmPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/settlement/confirmations`, 'POST', remyToken, {
        fromParticipantId: htooId,
        toParticipantId: remyId,
        currency: 'HKD',
      }),
      { params: { tripId } }
    );
    expect(confirmHkdRes.status).toBe(200);

    // 关键断言：只确认了 HKD，MYR 这一笔应该还是未确认——这正是这次改动要修的
    // bug（之前一对 from/to 只有一个确认状态，勾一个就等于全部都勾了）。
    const settlementAfterConfirmRes = await settlementGetHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/settlement`, 'GET', remyToken),
      { params: { tripId } }
    );
    const afterConfirmBody = (await settlementAfterConfirmRes.json()) as any;
    // GET /settlement 本身不返回 confirmed 状态（那是 page.tsx server component 自己
    // 拼的），这里直接查 DB 验证确认状态的隔离性。
    const confirmRows = await db.query.settlementConfirmations.findMany({ where: (t, { eq }) => eq(t.tripId, tripId) });
    expect(confirmRows).toHaveLength(1);
    expect(confirmRows[0]!.currency).toBe('HKD');
    expect(afterConfirmBody.transfers.some((t: any) => t.currency === 'MYR')).toBe(true); // MYR 那笔还在，没被误删/误标

    // 取消确认 HKD，行应该被删掉（跟之前的"取消勾选=删这一行"行为一致，只是现在
    // 精确到具体币种）。
    const unconfirmRes = await confirmDeleteHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/settlement/confirmations`, 'DELETE', remyToken, {
        fromParticipantId: htooId,
        toParticipantId: remyId,
        currency: 'HKD',
      }),
      { params: { tripId } }
    );
    expect(unconfirmRes.status).toBe(200);
    const confirmRowsAfterDelete = await db.query.settlementConfirmations.findMany({
      where: (t, { eq }) => eq(t.tripId, tripId),
    });
    expect(confirmRowsAfterDelete).toHaveLength(0);
  });

  // round74：loan/loan_repayment 接入结算净额计算——端到端集成测试，真的打
  // POST /loans + POST /loans/[loanId]/repayments + GET /settlement 三个真实
  // HTTP handler，确认 settlement-query.ts 那层查询真的把 loan/repayment 拼进了
  // 结算净额，不是只有 lib/domain/settlement.ts 纯函数单测过、查询层没接上。
  it('借出 US$1,000 部分还了 US$300，结算 GET 应该出现 htoo→remy 净欠 US$700 的一行', async () => {
    const provisionRes = await provisionHandler(
      jsonRequest('http://localhost/api/account/provision', 'POST', undefined)
    );
    const userToken = provisionRes.cookies.get(USER_SESSION_COOKIE_NAME)?.value!;
    const createTripRes = await tripsPostHandler(
      jsonRequest(
        'http://localhost/api/trips',
        'POST',
        undefined,
        { name: '借还钱接入结算测试行程', baseCurrency: 'HKD', ownerDisplayName: 'remy', participantNames: ['htoo'] },
        userToken
      )
    );
    const tripBody = (await createTripRes.json()) as any;
    const tripId: string = tripBody.trip.id;
    const remyToken = createTripRes.cookies.get(SESSION_COOKIE_NAME)?.value!;
    const remyId: string = tripBody.trip.ownerParticipantId;
    const htooId: string = tripBody.participants.find((p: any) => p.displayName === 'htoo').id;

    const loanRes = await loansPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/loans`, 'POST', remyToken, {
        lenderParticipantId: remyId,
        borrowerParticipantId: htooId,
        amount: 100000, // US$1,000
        currency: 'USD',
        fxRateUsed: 7.8,
        date: new Date().toISOString(),
      }),
      { params: { tripId } }
    );
    expect(loanRes.status).toBe(201);
    const loanId: string = ((await loanRes.json()) as any).loan.id;

    const repaymentRes = await repaymentsPostHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/loans/${loanId}/repayments`, 'POST', remyToken, {
        amount: 30000, // US$300，部分还款
        fxRateUsed: 7.8,
        date: new Date().toISOString(),
      }),
      { params: { tripId, loanId } }
    );
    expect(repaymentRes.status).toBe(201);

    const settlementRes = await settlementGetHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/settlement`, 'GET', remyToken),
      { params: { tripId } }
    );
    expect(settlementRes.status).toBe(200);
    const settlementBody = (await settlementRes.json()) as any;
    const usdTransfer = settlementBody.transfers.find(
      (t: any) => t.currency === 'USD' && t.fromParticipantId === htooId && t.toParticipantId === remyId
    );
    expect(usdTransfer).toBeDefined();
    expect(usdTransfer.amountOriginal).toBe(70000); // US$700 净欠，跟"借1000还300"完全对上
    expect(usdTransfer.amountBaseCurrency).toBe(Math.round(70000 * 7.8)); // 546000
  });
});
