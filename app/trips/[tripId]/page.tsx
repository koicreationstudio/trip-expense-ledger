import { and, desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import { exchangeRecords, expenses, participants, paymentMethods, trips, wallets } from '@/lib/db/schema';
import { getCurrentIdentity } from '@/lib/auth/current-session';
import { loadSettlementInput } from '@/lib/db/settlement-query';
import { computeNetBalances } from '@/lib/domain/settlement';
import { formatMoney, getCurrencySymbol } from '@/lib/money';
import { Avatar } from '@/components/avatar';
import { ExpenseList } from './expense-list';
import { WalletGrid } from './wallet-grid';
import { ExchangeRecordList } from './exchange-record-list';
import { FxRateCard } from './fx-rate-card';
import { paymentMethodOwnerFilter } from '@/lib/domain/payment-method-scope';

const STATUS_LABEL: Record<string, string> = {
  active: '记账中',
  settled: '已结算',
  archived: '已归档',
};

export default async function TripPage({ params }: { params: { tripId: string } }) {
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
  const nameById = new Map(tripParticipants.map((p) => [p.id, p.displayName]));

  // ① 余额 hero + ② 参与者净额清单共用同一份结算计算，一次查询两处复用。
  const settlementInput = await loadSettlementInput(db, params.tripId);
  const netBalances = computeNetBalances(settlementInput);
  const myNet = netBalances.get(identity.participantId) ?? 0;
  const unsettledCount = settlementInput.length;

  // ③ 活动流：整个行程的消费都要看见（同行人分摊的前提是能看到对方记了什么），
  // 不再按 enteredByParticipantId 过滤。编辑/删除权限边界仍然只认自己录入的那些，
  // 交给 ExpenseList 按 `mine` 字段区分，不是靠这里少查数据来兜底。
  const tripExpenses = await db
    .select()
    .from(expenses)
    .where(eq(expenses.tripId, params.tripId))
    .orderBy(desc(expenses.expenseDate));

  // 钱包 + 换汇记录都私有：硬编码 participant_id = 自己，跟活动流那种「整个行程可见」
  // 是完全不同的性质（这里是「我自己的现金在哪张卡/现金里」，不共享）。
  const myWallets = await db
    .select()
    .from(wallets)
    .where(and(eq(wallets.tripId, params.tripId), eq(wallets.participantId, identity.participantId)))
    .orderBy(wallets.createdAt);

  const myExchangeRecords = await db
    .select()
    .from(exchangeRecords)
    .where(and(eq(exchangeRecords.tripId, params.tripId), eq(exchangeRecords.participantId, identity.participantId)))
    .orderBy(desc(exchangeRecords.exchangeDate));

  const walletById = new Map(myWallets.map((w) => [w.id, w]));

  // 钱包卡片上要能显示「绑了哪个支付方式」+ 建钱包时要能选支付方式，两处都需要
  // 这份清单。payment_method 跟人走不跟行程走，按 participant_id 查，不用管 tripId。
  const myPaymentMethods = await db
    .select()
    .from(paymentMethods)
    .where(paymentMethodOwnerFilter(identity));
  const paymentMethodLabelById = new Map(myPaymentMethods.map((m) => [m.id, m.label]));

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="text-base font-semibold text-gold-dk">{trip.name}</h1>
        <p className="mt-0.5 text-[10px] text-muted">
          本位币 {trip.baseCurrency} · {STATUS_LABEL[trip.status] ?? trip.status}
        </p>
      </div>

      <section className="relative flex flex-col gap-2 overflow-hidden rounded-hero bg-hero-gradient p-4 text-white shadow-hero">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-4 -right-2 select-none font-serif text-[140px] italic leading-none text-white/[.05]"
        >
          {getCurrencySymbol(trip.baseCurrency)}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-slate-400">我的净额</span>
        <span
          className={`font-serif text-2xl font-medium tabular-nums tracking-tight ${
            myNet >= 0 ? 'text-emerald-400' : 'text-red-400'
          }`}
        >
          {myNet >= 0 ? '+' : '-'}
          {formatMoney(Math.abs(myNet), trip.baseCurrency)}
        </span>
        <span className="text-xs text-slate-400">
          {myNet >= 0 ? '该收回' : '该付出'} · {unsettledCount} 笔消费
        </span>
        <Link
          href={`/trips/${trip.id}/settlement`}
          className="relative mt-1 inline-flex min-h-[32px] w-fit items-center gap-1 rounded-full bg-white/10 px-[9px] py-[3px] text-[10px] text-slate-200"
        >
          查看结算明细 →
        </Link>
      </section>

      <FxRateCard tripId={trip.id} baseCurrency={trip.baseCurrency} hasPaymentMethods={myPaymentMethods.length > 0} />

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[12.5px] font-semibold text-ink">我的钱包</h2>
          <span className="text-[10px] text-muted">仅自己可见</span>
        </div>
        <WalletGrid
          tripId={trip.id}
          wallets={myWallets.map((w) => ({
            id: w.id,
            label: w.label,
            currency: w.currency,
            emoji: w.emoji,
            currentBalance: w.currentBalance,
            paymentMethodId: w.paymentMethodId,
            linkedPaymentMethodLabel: w.paymentMethodId ? paymentMethodLabelById.get(w.paymentMethodId) ?? null : null,
          }))}
          paymentMethods={myPaymentMethods.map((m) => ({
            id: m.id,
            label: m.label,
            settlementCurrency: m.settlementCurrency,
          }))}
        />
        <Link href={`/trips/${trip.id}/exchange/new`} className="tap-link self-start text-sm text-gold-dk">
          💱 取款 / 换汇
        </Link>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[12.5px] font-semibold text-ink">参与者</h2>
        <ul
          data-fab-avoid
          className="flex flex-col gap-1 rounded-xl border border-sand bg-[#EDE8DA]/35 px-[9px] py-[5px]"
        >
          {tripParticipants.map((p) => {
            const net = netBalances.get(p.id) ?? 0;
            const isMe = p.id === identity.participantId;
            return (
              <li key={p.id} className="flex items-center gap-2 py-1">
                <Avatar name={p.displayName} size={24} />
                <div className="flex flex-1 flex-col">
                  <span className="text-[12.5px] font-medium">
                    {p.displayName}
                    {p.isOwner && <span className="ml-2 text-[10px] text-muted">创建者</span>}
                  </span>
                  <span
                    className={`inline-flex w-fit items-center rounded-full px-[9px] py-[3px] text-[9.5px] font-medium ${
                      p.claimedAt ? 'bg-ok-bg text-ok' : 'bg-gold-lt text-gold-dk'
                    }`}
                  >
                    {p.claimedAt ? '已认领' : '邀请待认领'}
                  </span>
                </div>
                {isMe ? (
                  <span className="text-[12.5px] text-muted">我自己</span>
                ) : (
                  <span
                    className={`text-[12.5px] font-medium ${net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
                  >
                    {net >= 0 ? '该收' : '该付'}{' '}
                    <span className="font-serif tabular-nums">{formatMoney(Math.abs(net), trip.baseCurrency)}</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[12.5px] font-semibold text-ink">活动流</h2>
        <ExpenseList
          tripId={trip.id}
          myParticipantId={identity.participantId}
          expenses={tripExpenses.map((e) => ({
            id: e.id,
            category: e.category,
            amount: e.amount,
            currency: e.currency,
            expenseDate: e.expenseDate.toISOString(),
            hasReceipt: e.receiptPath !== null,
            payerName: nameById.get(e.payerParticipantId) ?? '未知',
            enteredByParticipantId: e.enteredByParticipantId,
          }))}
        />
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[12.5px] font-semibold text-ink">
            换汇 · <span className="font-mono text-[10px] uppercase tracking-wide">EXCHANGE</span>
          </h2>
          <span className="text-[10px] text-muted">仅自己可见</span>
        </div>
        <ExchangeRecordList
          records={myExchangeRecords.map((r) => ({
            id: r.id,
            fromLabel: r.fromWalletId ? walletById.get(r.fromWalletId)?.label ?? '未知钱包' : null,
            toLabel: walletById.get(r.toWalletId)?.label ?? '未知钱包',
            fromAmount: r.fromAmount,
            toAmount: r.toAmount,
            toCurrency: walletById.get(r.toWalletId)?.currency ?? '',
            fromCurrency: r.fromWalletId ? walletById.get(r.fromWalletId)?.currency ?? '' : '',
            exchangeDate: r.exchangeDate.toISOString(),
            note: r.note,
          }))}
        />
      </section>
    </main>
  );
}
