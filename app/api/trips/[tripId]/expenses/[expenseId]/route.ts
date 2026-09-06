import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { expenses, expenseSplits, participants, trips } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { toExpenseDto } from '@/lib/http/dto';
import { parseJsonBody } from '@/lib/http/validate';
import { updateExpenseSchema } from '@/lib/validation/schemas';
import { validateSplits } from '@/lib/http/expense-validation';
import { deleteReceipt } from '@/lib/storage/receipts';

interface Context {
  params: { tripId: string; expenseId: string };
}

/**
 * 不是自己录入的一律当不存在处理（404，不是 403）：
 * 查询条件里根本不看"谁在问"，只看"这条记录是不是自己录的"。
 */
async function loadOwnExpense(tripId: string, expenseId: string, participantId: string) {
  const expense = await db.query.expenses.findFirst({
    where: and(eq(expenses.id, expenseId), eq(expenses.tripId, tripId)),
    with: { splits: true },
  });
  if (!expense || expense.enteredByParticipantId !== participantId) return null;
  return expense;
}

export const GET = withSession<Context>(async (_request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const expense = await loadOwnExpense(params.tripId, params.expenseId, identity.participantId);
  if (!expense) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({
    expense: toExpenseDto(expense),
    splits: expense.splits.map((s) => ({
      participantId: s.participantId,
      shareAmountBaseCurrency: s.shareAmountBaseCurrency,
    })),
  });
});

export const PATCH = withSession<Context>(async (request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const existing = await loadOwnExpense(params.tripId, params.expenseId, identity.participantId);
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const parsed = await parseJsonBody(request, updateExpenseSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  const trip = await db.query.trips.findFirst({ where: eq(trips.id, params.tripId) });
  if (!trip) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const tripParticipants = await db.select().from(participants).where(eq(participants.tripId, params.tripId));
  const participantIds = new Set(tripParticipants.map((p) => p.id));

  if (body.payerParticipantId && !participantIds.has(body.payerParticipantId)) {
    return NextResponse.json({ error: 'invalid_payer' }, { status: 400 });
  }

  const amountOrCurrencyChanged = body.amount !== undefined || body.currency !== undefined;
  // 金额/币种一变，旧的 splits 总和肯定跟新总额对不上，必须在同一个请求里一起重传，
  // 不允许留一个「总额已经变了但分摊还是旧值」的中间态。
  if (amountOrCurrencyChanged && !body.splits) {
    return NextResponse.json({ error: 'splits_required_when_amount_changes' }, { status: 400 });
  }

  const nextAmount = body.amount ?? existing.amount;
  const nextCurrency = body.currency ?? existing.currency;

  let fxRateUsed = existing.fxRateUsed;
  let amountBaseCurrency = existing.amountBaseCurrency;

  if (amountOrCurrencyChanged) {
    if (nextCurrency === trip.baseCurrency) {
      fxRateUsed = 1;
      amountBaseCurrency = nextAmount;
    } else {
      if (body.fxRateUsed === undefined) {
        return NextResponse.json({ error: 'fx_rate_required' }, { status: 400 });
      }
      fxRateUsed = body.fxRateUsed;
      amountBaseCurrency = Math.round(nextAmount * fxRateUsed);
    }
  }

  if (body.splits) {
    const splitError = validateSplits(body.splits, amountBaseCurrency, participantIds);
    if (splitError) return splitError;
  }

  db.transaction((tx) => {
    tx.update(expenses)
      .set({
        payerParticipantId: body.payerParticipantId ?? existing.payerParticipantId,
        amount: nextAmount,
        currency: nextCurrency,
        amountBaseCurrency,
        fxRateUsed,
        category: body.category ?? existing.category,
        note: body.note !== undefined ? body.note : existing.note,
        expenseDate: body.expenseDate ? new Date(body.expenseDate) : existing.expenseDate,
        updatedAt: new Date(),
      })
      .where(eq(expenses.id, params.expenseId))
      .run();

    if (body.splits) {
      tx.delete(expenseSplits).where(eq(expenseSplits.expenseId, params.expenseId)).run();
      tx.insert(expenseSplits)
        .values(
          body.splits.map((s) => ({
            expenseId: params.expenseId,
            participantId: s.participantId,
            shareAmountBaseCurrency: s.shareAmountBaseCurrency,
          }))
        )
        .run();
    }
  });

  const updated = await db.query.expenses.findFirst({ where: eq(expenses.id, params.expenseId) });
  return NextResponse.json({ expense: toExpenseDto(updated!) });
});

export const DELETE = withSession<Context>(async (_request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const existing = await loadOwnExpense(params.tripId, params.expenseId, identity.participantId);
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (existing.receiptPath) {
    await deleteReceipt(existing.receiptPath);
  }

  await db.delete(expenses).where(eq(expenses.id, params.expenseId));

  return new NextResponse(null, { status: 204 });
});
