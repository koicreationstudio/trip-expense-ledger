/**
 * 所有对外响应的字段映射统一收在这里，一律显式列字段（不用对象展开），
 * 这样新加一个数据库列不会自动被响应体带出去，尤其是 expense 的 note/receiptPath
 * 这类只有本人能看的字段，必须每个响应形状自己决定要不要包含。
 */
import type {
  participants,
  trips,
  expenses,
  paymentMethods,
  wallets,
  exchangeRecords,
  walletBalanceHistory,
  loans,
  loanRepayments,
} from '../db/schema';

type ParticipantRow = typeof participants.$inferSelect;
type TripRow = typeof trips.$inferSelect;
type ExpenseRow = typeof expenses.$inferSelect;
type PaymentMethodRow = typeof paymentMethods.$inferSelect;
type WalletRow = typeof wallets.$inferSelect;
type ExchangeRecordRow = typeof exchangeRecords.$inferSelect;
type WalletBalanceHistoryRow = typeof walletBalanceHistory.$inferSelect;
type LoanRow = typeof loans.$inferSelect;
type LoanRepaymentRow = typeof loanRepayments.$inferSelect;

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
    merchant: row.merchant,
    note: row.note,
    excludeFromSplit: row.excludeFromSplit,
    sortOrder: row.sortOrder,
    hasReceipt: row.receiptPath !== null,
    expenseDate: row.expenseDate.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
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

/** 同一份支付方式，多带一个「这趟行程是否启用」布尔值——只在行程范围内的接口用。 */
export function toTripPaymentMethodDto(row: PaymentMethodRow, enabled: boolean) {
  return { ...toPaymentMethodDto(row), enabled };
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
    balanceUpdatedAt: row.balanceUpdatedAt ? row.balanceUpdatedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * 私有资源，只会出现在「查自己钱包的历史」这个响应里。`changedByParticipantId`
 * 照样带出来（字段本身留着，以后有需要随时能读），历史列表要不要渲染这个人是
 * 前端自己的展示决定，不是这一层该管的事——Remy 明确要求这轮列表别显示"由谁
 * 设置"这种操作者文字，但这不代表接口就该把这个字段砍掉。
 */
export function toWalletBalanceHistoryDto(row: WalletBalanceHistoryRow) {
  return {
    id: row.id,
    walletId: row.walletId,
    amount: row.amount,
    effectiveDate: row.effectiveDate.toISOString(),
    changedByParticipantId: row.changedByParticipantId,
    changedAt: row.changedAt.toISOString(),
    prevAmount: row.prevAmount,
    prevEffectiveDate: row.prevEffectiveDate ? row.prevEffectiveDate.toISOString() : null,
    displayBalanceBefore: row.displayBalanceBefore,
    displayBalanceAfter: row.displayBalanceAfter,
    // round72 第三批（历史记录可直接编辑）新增：非 null 就代表这条记录被编辑过至少
    // 一次，UI「已更正」标签是否显示直接看这个字段，不需要另外的布尔开关；语义详见
    // lib/db/schema.ts wallet_balance_history 表定义里这两个字段的注释。
    originalAmount: row.originalAmount,
    originalEffectiveDate: row.originalEffectiveDate ? row.originalEffectiveDate.toISOString() : null,
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

/** round72b：借钱/还钱功能。跟 expense 不同，这两张表没有"私密归属"这条边界——
 * lender/borrower 都是这笔记录的当事人，路由层按"我是当事人之一"过滤，不是
 * 单一 participantId 收窄，具体口径见 loans/route.ts 顶部注释。 */
export function toLoanDto(row: LoanRow) {
  return {
    id: row.id,
    tripId: row.tripId,
    lenderParticipantId: row.lenderParticipantId,
    borrowerParticipantId: row.borrowerParticipantId,
    amount: row.amount,
    currency: row.currency,
    amountBaseCurrency: row.amountBaseCurrency,
    fxRateUsed: row.fxRateUsed,
    fromWalletId: row.fromWalletId,
    date: row.date.toISOString(),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toLoanRepaymentDto(row: LoanRepaymentRow) {
  return {
    id: row.id,
    loanId: row.loanId,
    fromParticipantId: row.fromParticipantId,
    toParticipantId: row.toParticipantId,
    amount: row.amount,
    currency: row.currency,
    amountBaseCurrency: row.amountBaseCurrency,
    fxRateUsed: row.fxRateUsed,
    toWalletId: row.toWalletId,
    date: row.date.toISOString(),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}
