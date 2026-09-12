import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb, type Db } from '@/lib/db/client';
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
async function loadOwnExpense(db: Db, tripId: string, expenseId: string, participantId: string) {
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

  const db = await getDb();
  const expense = await loadOwnExpense(db, params.tripId, params.expenseId, identity.participantId);
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

  const db = await getDb();
  const existing = await loadOwnExpense(db, params.tripId, params.expenseId, identity.participantId);
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

  // D1 的 remote binding 不支持交互式多语句事务，官方推荐用 batch() 做原子
  // 多语句写入。splits 是否重传是运行时才知道的，batch() 的 TS 签名要求一个
  // 至少 1 项的元组类型来做逐项类型推断，这里数组长度可变，结构上退化成普通
  // 数组，做一次断言（运行时永远至少有 1 项：更新 expense 本体）。
  const statements = [
    db
      .update(expenses)
      .set({
        payerParticipantId: body.payerParticipantId ?? existing.payerParticipantId,
        amount: nextAmount,
        currency: nextCurrency,
        amountBaseCurrency,
        fxRateUsed,
        // 编辑时改支付方式只更新这个标记字段本身，不会回溯调整钱包余额——
        // 钱包扣减只在创建那一刻发生一次，这是 v1 明确的简化边界（见 POST handler 注释）。
        paymentMethodId: body.paymentMethodId !== undefined ? body.paymentMethodId : existing.paymentMethodId,
        category: body.category ?? existing.category,
        // body.merchant === '' 是显式清空（表单把商家名称删空后提交），跟 undefined
        // 的"没传这个字段，保持原值"分开处理，用 || null 把空字符串归一化成 null。
        merchant: body.merchant !== undefined ? body.merchant || null : existing.merchant,
        note: body.note !== undefined ? body.note : existing.note,
        expenseDate: body.expenseDate ? new Date(body.expenseDate) : existing.expenseDate,
        updatedAt: new Date(),
      })
      .where(eq(expenses.id, params.expenseId)),
    ...(body.splits
      ? [
          db.delete(expenseSplits).where(eq(expenseSplits.expenseId, params.expenseId)),
          db.insert(expenseSplits).values(
            body.splits.map((s) => ({
              expenseId: params.expenseId,
              participantId: s.participantId,
              shareAmountBaseCurrency: s.shareAmountBaseCurrency,
            }))
          ),
        ]
      : []),
  ];
  await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);

  const updated = await db.query.expenses.findFirst({ where: eq(expenses.id, params.expenseId) });
  return NextResponse.json({ expense: toExpenseDto(updated!) });
});

export const DELETE = withSession<Context>(async (_request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const existing = await loadOwnExpense(db, params.tripId, params.expenseId, identity.participantId);
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (existing.receiptPath) {
    await deleteReceipt(existing.receiptPath);
  }

  await db.delete(expenses).where(eq(expenses.id, params.expenseId));

  return new NextResponse(null, { status: 204 });
});
