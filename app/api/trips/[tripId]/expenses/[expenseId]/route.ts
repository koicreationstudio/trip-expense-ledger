import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb, type Db } from '@/lib/db/client';
import { expenses, expenseSplits, participants, trips, wallets } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { toExpenseDto } from '@/lib/http/dto';
import { parseJsonBody } from '@/lib/http/validate';
import { updateExpenseSchema } from '@/lib/validation/schemas';
import { validateSplits } from '@/lib/http/expense-validation';
import { deriveOriginalCurrencyShares } from '@/lib/domain/split';
import { deleteReceipt } from '@/lib/storage/receipts';
import { findDirectDebitWallet } from '@/lib/domain/wallet-balance';
import { loadEnabledPaymentMethodIds } from '@/lib/domain/payment-method-scope';

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

  // fix(2026-09-25 第七十轮)：跟 POST 同一条规则——编辑后代垫人如果是记录人自己，
  // 支付方式不能是空的。PATCH 是部分更新语义，body 里没传的字段要按"维持原值"
  // 算最终结果，再判断这个最终结果是否合规，不能只看这次请求body 里有没有传。
  // fix(2026-09-26 第七十一轮)：跟 POST 同一处补丁——这趟行程压根没启用任何支付
  // 方式时不能死堵编辑操作（不然连改个备注都会被"必须选支付方式"卡住），只在
  // 真的有支付方式可选时才要求必选。
  const nextPayerParticipantId = body.payerParticipantId ?? existing.payerParticipantId;
  const nextPaymentMethodId = body.paymentMethodId !== undefined ? body.paymentMethodId : existing.paymentMethodId;
  if (nextPayerParticipantId === identity.participantId && !nextPaymentMethodId) {
    const enabledIds = await loadEnabledPaymentMethodIds(db, params.tripId, identity);
    if (enabledIds.size > 0) {
      return NextResponse.json({ error: 'payment_method_required' }, { status: 400 });
    }
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

  // fix(2026-09-26 第七十一轮)：`nextPayerParticipantId`/`nextPaymentMethodId` 已经
  // 在上面第 72-73 行为"支付方式必填"校验算过一次（同一个部分更新合并规则：body
  // 里没传就维持 existing 原值），这里直接复用，不重复声明——这两组值在整个 PATCH
  // 函数里只有一个真实含义（"这次更新完成后最终会是什么"），不该有两份独立算出来
  // 却又必须永远保持一致的副本。

  // fix(第七十轮，"编辑改支付方式旧钱包不退回"bug 根治)：老注释在这里写的是
  // "编辑时改支付方式只更新标记字段，不回溯调整钱包余额"——这是真实事故的根因：
  // 一笔消费最初记在「现金 USD」钱包，后来编辑改成「USDT」，旧钱包的扣款从来没
  // 退回去过，导致「现金 USD」钱包一直多扣了这笔钱（详见 PENDING-DECISIONS 第
  // 七十轮）。这次补上：编辑前后分别算一次"这笔消费该扣哪个旧模式钱包"
  // （`findDirectDebitWallet`，已设置过"当前余额"的锚点模式钱包不受影响，会在
  // 下次读取时用 wallet-balance.ts 的推导公式自动算对，不需要这里处理），
  // 新旧钱包不是同一个就分别退回旧钱包、扣进新钱包；是同一个钱包就只按金额
  // 差额调整一次，不做"先退回全额再扣全额"这种会产生中间态的写法。
  const oldWallet = await findDirectDebitWallet(db, {
    tripId: params.tripId,
    ownerParticipantId: identity.participantId,
    payerParticipantId: existing.payerParticipantId,
    paymentMethodId: existing.paymentMethodId,
    currency: existing.currency,
  });
  const newWallet = await findDirectDebitWallet(db, {
    tripId: params.tripId,
    ownerParticipantId: identity.participantId,
    payerParticipantId: nextPayerParticipantId,
    paymentMethodId: nextPaymentMethodId,
    currency: nextCurrency,
  });

  const walletStatements: unknown[] = [];
  if (oldWallet && newWallet && oldWallet.id === newWallet.id) {
    // 同一个钱包：只调整金额差额，不产生"先退回全额、再扣全额"的两条语句。
    const delta = nextAmount - existing.amount;
    if (delta !== 0) {
      walletStatements.push(
        db
          .update(wallets)
          .set({ currentBalance: oldWallet.currentBalance - delta })
          .where(eq(wallets.id, oldWallet.id))
      );
    }
  } else {
    if (oldWallet) {
      walletStatements.push(
        db
          .update(wallets)
          .set({ currentBalance: oldWallet.currentBalance + existing.amount })
          .where(eq(wallets.id, oldWallet.id))
      );
    }
    if (newWallet) {
      walletStatements.push(
        db
          .update(wallets)
          .set({ currentBalance: newWallet.currentBalance - nextAmount })
          .where(eq(wallets.id, newWallet.id))
      );
    }
  }

  // D1 的 remote binding 不支持交互式多语句事务，官方推荐用 batch() 做原子
  // 多语句写入。splits/钱包调整是否需要都是运行时才知道的，batch() 的 TS 签名
  // 要求一个至少 1 项的元组类型来做逐项类型推断，这里数组长度可变，结构上退化成
  // 普通数组，做一次断言（运行时永远至少有 1 项：更新 expense 本体）。
  const statements = [
    db
      .update(expenses)
      .set({
        payerParticipantId: nextPayerParticipantId,
        amount: nextAmount,
        currency: nextCurrency,
        amountBaseCurrency,
        fxRateUsed,
        paymentMethodId: nextPaymentMethodId,
        category: body.category ?? existing.category,
        // body.merchant === '' 是显式清空（表单把商家名称删空后提交），跟 undefined
        // 的"没传这个字段，保持原值"分开处理，用 || null 把空字符串归一化成 null。
        merchant: body.merchant !== undefined ? body.merchant || null : existing.merchant,
        note: body.note !== undefined ? body.note : existing.note,
        excludeFromSplit: body.excludeFromSplit !== undefined ? body.excludeFromSplit : existing.excludeFromSplit,
        expenseDate: body.expenseDate ? new Date(body.expenseDate) : existing.expenseDate,
        updatedAt: new Date(),
      })
      .where(eq(expenses.id, params.expenseId)),
    ...(body.splits
      ? [
          db.delete(expenseSplits).where(eq(expenseSplits.expenseId, params.expenseId)),
          db.insert(expenseSplits).values(
            (() => {
              // fix(2026-09-26，"结算按币种拆开显示")：编辑重传 splits 时，
              // shareAmountOriginal 也要跟着重新精确算一遍（最大余数法，
              // 总和严格等于 nextAmount），跟 POST 那边同一套换算，不是只更新
              // shareAmountBaseCurrency 留 original 字段过期。
              const originalShares = deriveOriginalCurrencyShares(body.splits!, amountBaseCurrency, nextAmount);
              const originalShareByParticipant = new Map(
                originalShares.map((s) => [s.participantId, s.shareAmountOriginal])
              );
              return body.splits!.map((s) => ({
                expenseId: params.expenseId,
                participantId: s.participantId,
                shareAmountBaseCurrency: s.shareAmountBaseCurrency,
                shareAmountOriginal: originalShareByParticipant.get(s.participantId) ?? 0,
              }));
            })()
          ),
        ]
      : []),
    ...walletStatements,
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

  // fix(第七十轮，同一个根因)：删除这笔消费如果它曾经直接扣过某个旧模式钱包，
  // 要把这次扣款退回去——之前这里完全没有这段逻辑，是"编辑/删除消费不会回滚
  // 钱包余额"这个既有缺口的另一半（已设置过"当前余额"的锚点模式钱包不受影响，
  // 行删掉之后下次读取会自动算对，见 wallet-balance.ts）。
  const linkedWallet = await findDirectDebitWallet(db, {
    tripId: params.tripId,
    ownerParticipantId: identity.participantId,
    payerParticipantId: existing.payerParticipantId,
    paymentMethodId: existing.paymentMethodId,
    currency: existing.currency,
  });

  const statements: unknown[] = [db.delete(expenses).where(eq(expenses.id, params.expenseId))];
  if (linkedWallet) {
    statements.push(
      db
        .update(wallets)
        .set({ currentBalance: linkedWallet.currentBalance + existing.amount })
        .where(eq(wallets.id, linkedWallet.id))
    );
  }
  await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);

  return new NextResponse(null, { status: 204 });
});
