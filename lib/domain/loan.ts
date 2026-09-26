/**
 * loan/loan_repayment 相关的纯计算——不碰数据库，方便 vitest 直接灌数字验证。
 * 「借款清单」的还款状态/进度条要用的核心公式都收在这里，是唯一权威实现，页面
 * 组件/API 路由都调这个，不各自重新写一份加减。
 */

export type LoanStatus = 'unpaid' | 'partial' | 'paid';

export interface LoanProgress {
  /** 已还总额（原始最小货币单位，见 schema.ts loan_repayment 顶部注释关于币种的说明） */
  repaidAmount: number;
  /** 还剩多少没还（不会是负数，还多了也封顶在 0，不会显示"倒欠"） */
  outstandingAmount: number;
  /** 0-100 整数百分比，封顶 100，loanAmount<=0 时视为 0（不应该发生，防御一下） */
  percentRepaid: number;
  status: LoanStatus;
}

/**
 * ⚠️ 见 schema.ts loan_repayment 顶部注释的开放问题：这里对 `repaidAmount` 的
 * 计算是把这笔 loan 名下所有 repayment.amount 直接相加，没有做任何汇率换算——
 * 如果某笔还款用的钱包币种跟 loan.currency 不同（借出 USD、还回 USDT 钱包这种
 * 题目描述的正常场景），这个百分比在数学上不严谨。这轮先照字面数字算，是刻意
 * 标注的简化，不是没考虑到，需要 Remy/PM 确认要不要加汇率换算。
 */
export function computeLoanProgress(loanAmount: number, repayments: { amount: number }[]): LoanProgress {
  const repaidAmount = repayments.reduce((sum, r) => sum + r.amount, 0);
  const outstandingAmount = Math.max(loanAmount - repaidAmount, 0);
  const percentRepaid = loanAmount > 0 ? Math.min(100, Math.round((repaidAmount / loanAmount) * 100)) : 0;
  const status: LoanStatus = repaidAmount <= 0 ? 'unpaid' : outstandingAmount <= 0 ? 'paid' : 'partial';
  return { repaidAmount, outstandingAmount, percentRepaid, status };
}
