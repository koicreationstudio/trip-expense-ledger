import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { expenses, expenseSplits, participants, trips, wallets } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { toExpenseDto } from '@/lib/http/dto';
import { parseJsonBody } from '@/lib/http/validate';
import { createExpenseSchema } from '@/lib/validation/schemas';
import { deriveOriginalCurrencyShares, equalSplit } from '@/lib/domain/split';
import { validateSplits } from '@/lib/http/expense-validation';
import { findDirectDebitWallet } from '@/lib/domain/wallet-balance';
import { loadEnabledPaymentMethodIds } from '@/lib/domain/payment-method-scope';

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

  // fix(2026-09-25 第七十轮，追加2 那条"记账不选支付方式显示成现金HKD"bug 的根治
  // 防线)：代垫人是记录人自己时，必须选支付方式——不知道自己用哪张卡/钱包付的钱
  // 这件事本身就不合理，不能让它静默落成任何默认值。代垫人不是自己（别人代垫）时
  // 不强制，因为记录人本来就不一定知道对方用什么支付方式付的钱。前端已经用禁用
  // 提交按钮拦过一层，这里是后端最后一道关卡，不能只信前端。
  // fix(2026-09-26 第七十一轮)：这趟行程压根没启用任何支付方式时不能死堵——用户
  // 没有任何东西可选，硬性要求「必须选一个」等于永远记不了账。只在真的有支付方式
  // 可选（`loadEnabledPaymentMethodIds` 非空）时才要求必选，前端同一份判断逻辑
  // 见 expense-form.tsx / quick-add-expense.tsx 的 `paymentMethodRequired`。
  if (body.payerParticipantId === identity.participantId && !body.paymentMethodId) {
    const enabledIds = await loadEnabledPaymentMethodIds(db, params.tripId, identity);
    if (enabledIds.size > 0) {
      return NextResponse.json({ error: 'payment_method_required' }, { status: 400 });
    }
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

  // fix(2026-09-26 第七十一轮，任务⑤)：新记一笔账，在"手动排序"里默认排到这趟
  // 行程流水账的最末位（sortOrder = 当前最大值 + 1），不是天然排最前——新记的账
  // 多半是"最近发生的事"，直觉上接在更早消费后面比突然插到最前面更符合"流水账"
  // 的心智模型，这是这次的产品判断，需要 Remy 确认认不认可。按整趟行程算最大值
  // （不按 enteredByParticipantId 收窄）——活动流现在是整趟行程共享的一条流水
  // （page.tsx 第 64-66 行注释："整个行程的消费都要看见……不再按
  // enteredByParticipantId 过滤"），手动排序顺序也是所有人看到的同一份共享顺序，
  // 不是"我自己"专属的排序。
  const maxSortOrderRow = await db
    .select({ sortOrder: expenses.sortOrder })
    .from(expenses)
    .where(eq(expenses.tripId, params.tripId))
    .orderBy(desc(expenses.sortOrder))
    .limit(1);
  const nextSortOrder = (maxSortOrderRow[0]?.sortOrder ?? -1) + 1;

  const insertExpense = db.insert(expenses).values({
    id: expenseId,
    tripId: params.tripId,
    enteredByParticipantId: identity.participantId,
    payerParticipantId: body.payerParticipantId,
    amount: body.amount,
    currency: body.currency,
    amountBaseCurrency,
    fxRateUsed,
    fxRateSource: 'manual',
    paymentMethodId: body.paymentMethodId ?? null,
    category: body.category,
    merchant: body.merchant || null,
    note: body.note ?? null,
    excludeFromSplit: body.excludeFromSplit ?? false,
    sortOrder: nextSortOrder,
    expenseDate: new Date(body.expenseDate),
  });
  // fix(2026-09-26，"结算按币种拆开显示")：新记录落库那一刻就精确算好
  // shareAmountOriginal（最大余数法，总和严格等于 body.amount，不会有一分钱
  // 分不出去悬空）——不管 splits 是自己 equalSplit 等分算的、还是客户端传来的
  // 自定义分摊，都在这里统一用同一套换算，不需要客户端自己算这个字段（客户端
  // 目前也确实没传，validation schema 只认 shareAmountBaseCurrency）。
  const originalShares = deriveOriginalCurrencyShares(splits, amountBaseCurrency, body.amount);
  const originalShareByParticipant = new Map(originalShares.map((s) => [s.participantId, s.shareAmountOriginal]));
  const insertSplits = db.insert(expenseSplits).values(
    splits.map((s) => ({
      expenseId,
      participantId: s.participantId,
      shareAmountBaseCurrency: s.shareAmountBaseCurrency,
      shareAmountOriginal: originalShareByParticipant.get(s.participantId) ?? 0,
    }))
  );

  // 记账自动扣钱包余额：只在「选了支付方式 + 那个支付方式绑了一个钱包 + 钱包币种
  // 跟这笔消费币种完全一致 + 付款人就是钱包主人自己」时才扣，不一致就静默跳过
  // （不做隐式换算猜汇率，也不用额外 UI 提示「没扣」——这是 v1 明确的简化边界，
  // DESIGN-BRIEF 之外的产品决定）。
  // fix(2026-09-24 第三十九轮)：这段只处理「这笔消费发生时钱包已经存在+已绑定」的
  // 情况——「钱包创建之前就已经存在的历史消费」这条互补的边界，改在
  // `app/api/trips/[tripId]/wallets/route.ts` POST 里处理（用
  // `expenses.createdAt < wallet.createdAt` 分界，创建钱包那一刻如果直接绑了支付
  // 方式，一次性把这条线以内的历史消费补进起始余额），这两段各管一半时间线，刚好
  // 在钱包诞生那一刻接力，不重叠、不用互相知道对方的存在。
  //
  // fix(2026-09-24 第五十轮，"设置当前余额"覆盖式 bug 修复)：钱包一旦做过至少一次
  // "设置当前余额"（`balanceUpdatedAt` 非空），就切换进 lib/domain/wallet-balance.ts
  // 的"锚点+推导"模式——这笔新消费不再在这里直接写一次 currentBalance 增量，交给
  // 读取时的推导公式自动把它算进去。只有还没做过"设置当前余额"的钱包才继续走这里
  // 直接写入的路径，判断口径见 `findDirectDebitWallet`（第七十轮抽成 chokepoint）。
  //
  // fix(第七十轮)：判断口径本身也在这次改了——以前只看「支付方式+币种匹配 identity
  // 自己的钱包」就扣，没管这笔消费的付款人是谁；Remy 帮全部参与者代录消费，导致
  // htoo 自己垫付的钱（payerParticipantId=htoo）也从 Remy 的钱包扣掉。现在
  // `findDirectDebitWallet` 明确要求 `body.payerParticipantId === identity.participantId`
  // 才会匹配到钱包，见该函数顶部注释。
  const linkedWallet = await findDirectDebitWallet(db, {
    tripId: params.tripId,
    ownerParticipantId: identity.participantId,
    payerParticipantId: body.payerParticipantId,
    paymentMethodId: body.paymentMethodId ?? null,
    currency: body.currency,
  });

  // D1 的 remote binding 不支持交互式多语句事务，官方推荐用 batch() 做原子
  // 多语句写入，各条语句互不依赖对方的执行结果，符合 batch 的用法。
  if (linkedWallet) {
    const debitWallet = db
      .update(wallets)
      .set({ currentBalance: linkedWallet.currentBalance - body.amount })
      .where(eq(wallets.id, linkedWallet.id));
    await db.batch([insertExpense, insertSplits, debitWallet]);
  } else {
    await db.batch([insertExpense, insertSplits]);
  }

  const created = await db.query.expenses.findFirst({ where: eq(expenses.id, expenseId) });

  return NextResponse.json({ expense: toExpenseDto(created!) }, { status: 201 });
});
