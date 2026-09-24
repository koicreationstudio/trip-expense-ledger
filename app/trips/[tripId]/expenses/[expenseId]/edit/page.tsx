import { and, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import { expenses, participants, paymentMethods, trips } from '@/lib/db/schema';
import { getCurrentIdentity } from '@/lib/auth/current-session';
import { loadEnabledPaymentMethodIds, paymentMethodOwnerFilter } from '@/lib/domain/payment-method-scope';
// fix(2026-09-24，Remy 真实反馈的真 bug，见 payment-method-label.ts 顶部注释)：
// "现金"HKD/USD 同名支付方式在这个下拉里也分不清，不只是汇率比价卡片那一处。
import { disambiguatePaymentMethodLabels } from '@/lib/domain/payment-method-label';
import { ExpenseForm } from '../../expense-form';

/**
 * 只有自己录入的消费才能编辑：查询条件直接把 enteredByParticipantId 焊死在
 * WHERE 里，跟 API 层 loadOwnExpense 用同一个权限原则——不是自己的一律
 * redirect 回行程主页，不区分「不存在」和「是别人的」。
 */
export default async function EditExpensePage({
  params,
}: {
  params: { tripId: string; expenseId: string };
}) {
  const identity = await getCurrentIdentity();
  if (!identity || identity.tripId !== params.tripId) {
    redirect('/');
  }

  const db = await getDb();
  const trip = await db.query.trips.findFirst({ where: eq(trips.id, params.tripId) });
  if (!trip) {
    redirect('/');
  }

  const expense = await db.query.expenses.findFirst({
    where: and(eq(expenses.id, params.expenseId), eq(expenses.tripId, params.tripId)),
    with: { splits: true },
  });
  if (!expense || expense.enteredByParticipantId !== identity.participantId) {
    redirect(`/trips/${params.tripId}`);
  }

  const tripParticipants = await db.select().from(participants).where(eq(participants.tripId, params.tripId));

  const myPaymentMethods = await db
    .select()
    .from(paymentMethods)
    .where(paymentMethodOwnerFilter(identity));
  // 「记一笔消费」支付方式下拉只列这趟行程勾了「启用」的那几个（2026-09-15 落地
  // Artifact Version 10 遗留缺口）。编辑态额外补一条例外：这笔消费当初选的支付方式
  // 如果之后被取消勾选了，下拉里还是要留着它（不然编辑页会显示"选中了一个不存在的
  // 选项"，或者悄悄把用户没碰过的字段改没了），不强行帮用户换掉历史选择。
  const enabledIds = await loadEnabledPaymentMethodIds(db, params.tripId, identity);
  const enabledPaymentMethods = myPaymentMethods.filter(
    (m) => enabledIds.has(m.id) || m.id === expense.paymentMethodId
  );
  const displayLabels = disambiguatePaymentMethodLabels(enabledPaymentMethods);

  return (
    // fix(2026-09-16 第十七轮)：gap-6(24px)→gap-3.5(14px)、标题 16px→15px，跟本站其它屏统一。
    <main className="flex flex-col gap-3.5">
      {/* fix(2026-09-18，第二十六轮全量复核)：同 settlement/page.tsx 那条注释，跨屏字重
          不一致，改成 font-bold 对齐 Artifact `.title-block h3{font-weight:700}`。"编辑
          消费"这个标题本身不在 Artifact 9屏范围内(是真实功能页)，但沿用同一套全站
          title-block 规则统一处理，不单独破例。 */}
      <h1 className="text-[15px] font-bold text-ink">编辑消费</h1>
      <ExpenseForm
        tripId={trip.id}
        baseCurrency={trip.baseCurrency}
        myParticipantId={identity.participantId}
        participants={tripParticipants.map((p) => ({ id: p.id, displayName: p.displayName }))}
        paymentMethods={enabledPaymentMethods.map((m) => ({ id: m.id, label: displayLabels.get(m.id) ?? m.label }))}
        initialExpense={{
          id: expense.id,
          amount: expense.amount,
          currency: expense.currency,
          payerParticipantId: expense.payerParticipantId,
          category: expense.category,
          merchant: expense.merchant,
          note: expense.note,
          expenseDate: expense.expenseDate.toISOString(),
          fxRateUsed: expense.fxRateUsed,
          amountBaseCurrency: expense.amountBaseCurrency,
          hasReceipt: expense.receiptPath !== null,
          paymentMethodId: expense.paymentMethodId,
          excludeFromSplit: expense.excludeFromSplit,
          splits: expense.splits.map((s) => ({
            participantId: s.participantId,
            shareAmountBaseCurrency: s.shareAmountBaseCurrency,
          })),
        }}
      />
    </main>
  );
}
