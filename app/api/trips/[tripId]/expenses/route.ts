import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { expenses, expenseSplits, participants, trips } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { toExpenseDto } from '@/lib/http/dto';
import { parseJsonBody } from '@/lib/http/validate';
import { createExpenseSchema } from '@/lib/validation/schemas';
import { equalSplit } from '@/lib/domain/split';
import { validateSplits } from '@/lib/http/expense-validation';

interface Context {
  params: { tripId: string };
}

/**
 * 列表接口内部硬编码 entered_by_participant_id = 自己，不接受任何客户端传参
 * 覆盖这个过滤条件 —— 这是 CLAUDE.md 权限边界里唯一不能让步的一条。
 */
export const GET = withSession<Context>(async (_request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const rows = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.tripId, params.tripId), eq(expenses.enteredByParticipantId, identity.participantId)))
    .orderBy(desc(expenses.expenseDate));

  return NextResponse.json({ expenses: rows.map(toExpenseDto) });
});

export const POST = withSession<Context>(async (request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const parsed = await parseJsonBody(request, createExpenseSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  const trip = await db.query.trips.findFirst({ where: eq(trips.id, params.tripId) });
  if (!trip) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const tripParticipants = await db.select().from(participants).where(eq(participants.tripId, params.tripId));
  const participantIds = new Set(tripParticipants.map((p) => p.id));

  if (!participantIds.has(body.payerParticipantId)) {
    return NextResponse.json({ error: 'invalid_payer' }, { status: 400 });
  }

  let fxRateUsed = 1;
  let amountBaseCurrency = body.amount;

  if (body.currency !== trip.baseCurrency) {
    if (body.fxRateUsed === undefined) {
      return NextResponse.json({ error: 'fx_rate_required' }, { status: 400 });
    }
    fxRateUsed = body.fxRateUsed;
    amountBaseCurrency = Math.round(body.amount * fxRateUsed);
  }

  const splits = body.splits ?? equalSplit(amountBaseCurrency, tripParticipants.map((p) => p.id));
  const splitError = validateSplits(splits, amountBaseCurrency, participantIds);
  if (splitError) return splitError;

  const expenseId = crypto.randomUUID();

  // D1 的 remote binding 不支持交互式多语句事务，官方推荐用 batch() 做原子
  // 多语句写入，两条语句互不依赖对方的执行结果，符合 batch 的用法。
  await db.batch([
    db.insert(expenses).values({
      id: expenseId,
      tripId: params.tripId,
      enteredByParticipantId: identity.participantId,
      payerParticipantId: body.payerParticipantId,
      amount: body.amount,
      currency: body.currency,
      amountBaseCurrency,
      fxRateUsed,
      fxRateSource: 'manual',
      category: body.category,
      note: body.note ?? null,
      expenseDate: new Date(body.expenseDate),
    }),
    db.insert(expenseSplits).values(
      splits.map((s) => ({
        expenseId,
        participantId: s.participantId,
        shareAmountBaseCurrency: s.shareAmountBaseCurrency,
      }))
    ),
  ]);

  const created = await db.query.expenses.findFirst({ where: eq(expenses.id, expenseId) });

  return NextResponse.json({ expense: toExpenseDto(created!) }, { status: 201 });
});
