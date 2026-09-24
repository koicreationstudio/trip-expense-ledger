import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import { participants, paymentMethods, trips } from '@/lib/db/schema';
import { getCurrentIdentity } from '@/lib/auth/current-session';
import { loadEnabledPaymentMethodIds, paymentMethodOwnerFilter } from '@/lib/domain/payment-method-scope';
// fix(2026-09-24，Remy 真实反馈的真 bug，见 payment-method-label.ts 顶部注释)：
// "现金"HKD/USD 同名支付方式在这个下拉里也分不清，不只是汇率比价卡片那一处。
import { disambiguatePaymentMethodLabels } from '@/lib/domain/payment-method-label';
import { ExpenseForm } from '../expense-form';

export default async function NewExpensePage({ params }: { params: { tripId: string } }) {
  const identity = await getCurrentIdentity();
  if (!identity || identity.tripId !== params.tripId) {
    redirect('/');
  }

  const db = await getDb();
  const trip = await db.query.trips.findFirst({ where: eq(trips.id, params.tripId) });
  if (!trip) {
    redirect('/');
  }

  const tripParticipants = await db.select().from(participants).where(eq(participants.tripId, params.tripId));

  const myPaymentMethods = await db
    .select()
    .from(paymentMethods)
    .where(paymentMethodOwnerFilter(identity));
  // 「记一笔消费」支付方式下拉只列这趟行程勾了「启用」的那几个（2026-09-15 落地
  // Artifact Version 10 遗留缺口），不是名下全部——见 payment-methods-manager.tsx
  // 「本行程启用的支付方式」区块。
  const enabledIds = await loadEnabledPaymentMethodIds(db, params.tripId, identity);
  const enabledPaymentMethods = myPaymentMethods.filter((m) => enabledIds.has(m.id));
  const displayLabels = disambiguatePaymentMethodLabels(enabledPaymentMethods);

  return (
    // fix(2026-09-16 第十七轮)：标题字号跟 gap 同一批漂移，理由跟 invites/page.tsx 那条一样。
    <main className="flex flex-col gap-3.5">
      {/* fix(2026-09-18，第二十六轮全量复核)：同 settlement/page.tsx 那条注释，跨屏字重
          不一致，改成 font-bold 对齐 Artifact `.title-block h3{font-weight:700}`。 */}
      <h1 className="text-[15px] font-bold text-ink">记一笔消费</h1>
      <ExpenseForm
        tripId={trip.id}
        baseCurrency={trip.baseCurrency}
        myParticipantId={identity.participantId}
        participants={tripParticipants.map((p) => ({ id: p.id, displayName: p.displayName }))}
        paymentMethods={enabledPaymentMethods.map((m) => ({ id: m.id, label: displayLabels.get(m.id) ?? m.label }))}
      />
    </main>
  );
}
