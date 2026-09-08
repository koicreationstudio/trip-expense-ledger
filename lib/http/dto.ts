/**
 * 所有对外响应的字段映射统一收在这里，一律显式列字段（不用对象展开），
 * 这样新加一个数据库列不会自动被响应体带出去，尤其是 expense 的 note/receiptPath
 * 这类只有本人能看的字段，必须每个响应形状自己决定要不要包含。
 */
import type { participants, trips, expenses, paymentMethods, users, wallets, exchangeRecords } from '../db/schema';

type ParticipantRow = typeof participants.$inferSelect;
type TripRow = typeof trips.$inferSelect;
type ExpenseRow = typeof expenses.$inferSelect;
type PaymentMethodRow = typeof paymentMethods.$inferSelect;
type UserRow = typeof users.$inferSelect;
type WalletRow = typeof wallets.$inferSelect;
type ExchangeRecordRow = typeof exchangeRecords.$inferSelect;

export function toParticipantSummaryDto(row: ParticipantRow) {
  return {
    id: row.id,
    displayName: row.displayName,
    isOwner: row.isOwner,
    claimed: row.claimedAt !== null,
  };
}

export function toTripDto(row: TripRow) {
  return {
    id: row.id,
    name: row.name,
    baseCurrency: row.baseCurrency,
    status: row.status,
    ownerParticipantId: row.ownerParticipantId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 只有 entered_by 本人能拿到的完整明细形状，含 note/是否有收据。 */
export function toExpenseDto(row: ExpenseRow) {
  return {
    id: row.id,
    tripId: row.tripId,
    enteredByParticipantId: row.enteredByParticipantId,
    payerParticipantId: row.payerParticipantId,
    amount: row.amount,
    currency: row.currency,
    amountBaseCurrency: row.amountBaseCurrency,
    fxRateUsed: row.fxRateUsed,
    fxRateSource: row.fxRateSource,
    paymentMethodId: row.paymentMethodId,
    category: row.category,
    note: row.note,
    hasReceipt: row.receiptPath !== null,
    expenseDate: row.expenseDate.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 绝不带 passwordHash，账号响应只暴露这三个字段。 */
export function toUserDto(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
  };
}

export function toPaymentMethodDto(row: PaymentMethodRow) {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind,
    settlementCurrency: row.settlementCurrency,
    fxMarkupPercent: row.fxMarkupPercent,
    foreignTxnFeePercent: row.foreignTxnFeePercent,
    fixedFee: row.fixedFee,
    cashbackPercent: row.cashbackPercent,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

/** 私有资源，只会出现在「查自己」的响应里，不做跨参与者展开。 */
export function toWalletDto(row: WalletRow) {
  return {
    id: row.id,
    tripId: row.tripId,
    label: row.label,
    currency: row.currency,
    emoji: row.emoji,
    currentBalance: row.currentBalance,
    paymentMethodId: row.paymentMethodId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toExchangeRecordDto(row: ExchangeRecordRow) {
  return {
    id: row.id,
    tripId: row.tripId,
    fromWalletId: row.fromWalletId,
    toWalletId: row.toWalletId,
    fromAmount: row.fromAmount,
    toAmount: row.toAmount,
    exchangeDate: row.exchangeDate.toISOString(),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}
