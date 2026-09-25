import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, type Db } from '@/lib/db/client';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';

/**
 * 第七十一轮任务⑤：活动流拖拽重排 API。覆盖：①正常重排，sortOrder 按新顺序数组
 * 下标重写 ②混进不属于这趟行程的 id 整个请求 400，不部分生效 ③数组里有重复 id
 * 400 ④这趟行程里的任何参与者都能重排（活动流是整趟行程共享的一条流水，不是
 * "只能重排自己录入的"那种收窄）⑤新记一笔账默认追加到手动排序最末位
 * （sortOrder = 当前最大值 + 1）。
 */

let db: Db;
let createSession: typeof import('@/lib/auth/session').createSession;
let SESSION_COOKIE_NAME: string;
let USER_SESSION_COOKIE_NAME: string;
let provisionHandler: typeof import('@/app/api/account/provision/route').POST;
let tripsPostHandler: typeof import('@/app/api/trips/route').POST;
let expensesPostHandler: typeof import('@/app/api/trips/[tripId]/expenses/route').POST;
let reorderHandler: typeof import('./route').PATCH;

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
  ({ POST: expensesPostHandler } = await import('@/app/api/trips/[tripId]/expenses/route'));
  ({ PATCH: reorderHandler } = await import('./route'));
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
      baseCurrency: 'MYR',
      ownerDisplayName: 'A',
      participantNames: ['B'],
    }, userToken)
  );
  expect(createTripRes.status).toBe(201);
  const tripBody = (await createTripRes.json()) as any;
  const tripId: string = tripBody.trip.id;
  const ownerParticipantId: string = tripBody.trip.ownerParticipantId;
  const aToken = createTripRes.cookies.get(SESSION_COOKIE_NAME)?.value!;
  const bParticipant = tripBody.participants.find((p: { displayName: string }) => p.displayName === 'B');
  const bToken = await createSession(db, bParticipant.id, null);
  return { tripId, aToken, bToken, ownerParticipantId };
}

async function createExpense(tripId: string, token: string, payerParticipantId: string, amount: number) {
  const res = await expensesPostHandler(
    jsonRequest(`http://localhost/api/trips/${tripId}/expenses`, 'POST', token, {
      payerParticipantId,
      amount,
      currency: 'MYR',
      category: '餐饮',
      expenseDate: new Date().toISOString(),
    }),
    { params: { tripId } }
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as any;
  return { id: body.expense.id as string, sortOrder: body.expense.sortOrder as number };
}

describe('PATCH /api/trips/[tripId]/expenses/reorder', () => {
  it('正常重排：sortOrder 按提交数组的下标重写', async () => {
    const { tripId, aToken, ownerParticipantId } = await setupTripWithTwoParticipants('🇯🇵测试行程-重排A');
    const e1 = await createExpense(tripId, aToken, ownerParticipantId, 100);
    const e2 = await createExpense(tripId, aToken, ownerParticipantId, 200);
    const e3 = await createExpense(tripId, aToken, ownerParticipantId, 300);

    const res = await reorderHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses/reorder`, 'PATCH', aToken, {
        orderedExpenseIds: [e3.id, e1.id, e2.id],
      }),
      { params: { tripId } }
    );
    expect(res.status).toBe(200);

    const rows = await db.query.expenses.findMany({ where: (t, { eq }) => eq(t.tripId, tripId) });
    const byId = new Map(rows.map((r) => [r.id, r.sortOrder]));
    expect(byId.get(e3.id)).toBe(0);
    expect(byId.get(e1.id)).toBe(1);
    expect(byId.get(e2.id)).toBe(2);
  });

  it('数组里混进不属于这趟行程的 id：整个请求 400，不部分生效', async () => {
    const { tripId, aToken, ownerParticipantId } = await setupTripWithTwoParticipants('🇯🇵测试行程-重排B');
    const e1 = await createExpense(tripId, aToken, ownerParticipantId, 100);

    const res = await reorderHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses/reorder`, 'PATCH', aToken, {
        orderedExpenseIds: [e1.id, 'not-a-real-expense-id'],
      }),
      { params: { tripId } }
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe('invalid_expense_id');

    // 没有部分生效——e1 的 sortOrder 应该维持创建时的原值，不是被改成 0。
    const row = await db.query.expenses.findFirst({ where: (t, { eq }) => eq(t.id, e1.id) });
    expect(row?.sortOrder).toBe(e1.sortOrder);
  });

  it('数组里有重复 id：400', async () => {
    const { tripId, aToken, ownerParticipantId } = await setupTripWithTwoParticipants('🇯🇵测试行程-重排C');
    const e1 = await createExpense(tripId, aToken, ownerParticipantId, 100);
    const e2 = await createExpense(tripId, aToken, ownerParticipantId, 200);

    const res = await reorderHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses/reorder`, 'PATCH', aToken, {
        orderedExpenseIds: [e1.id, e2.id, e1.id],
      }),
      { params: { tripId } }
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe('duplicate_expense_id');
  });

  it('B（同一行程的另一个参与者）也能重排 A 录入的消费——活动流是整趟行程共享的一条流水', async () => {
    const { tripId, aToken, bToken, ownerParticipantId } = await setupTripWithTwoParticipants('🇯🇵测试行程-重排D');
    const e1 = await createExpense(tripId, aToken, ownerParticipantId, 100);
    const e2 = await createExpense(tripId, aToken, ownerParticipantId, 200);

    const res = await reorderHandler(
      jsonRequest(`http://localhost/api/trips/${tripId}/expenses/reorder`, 'PATCH', bToken, {
        orderedExpenseIds: [e2.id, e1.id],
      }),
      { params: { tripId } }
    );
    expect(res.status).toBe(200);
    const row = await db.query.expenses.findFirst({ where: (t, { eq }) => eq(t.id, e2.id) });
    expect(row?.sortOrder).toBe(0);
  });

  it('新记一笔账默认追加到手动排序最末位（sortOrder = 当前最大值 + 1）', async () => {
    const { tripId, aToken, ownerParticipantId } = await setupTripWithTwoParticipants('🇯🇵测试行程-重排E');
    const e1 = await createExpense(tripId, aToken, ownerParticipantId, 100);
    expect(e1.sortOrder).toBe(0);
    const e2 = await createExpense(tripId, aToken, ownerParticipantId, 200);
    expect(e2.sortOrder).toBe(1);
    const e3 = await createExpense(tripId, aToken, ownerParticipantId, 300);
    expect(e3.sortOrder).toBe(2);
  });
});
