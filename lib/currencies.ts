/** 出差常见币种，够 v0.1 用；不是穷举，用户要的币种不在列表里也可以手动改。 */
export const COMMON_CURRENCIES = [
  'MYR',
  'USD',
  'HKD',
  'THB',
  'PHP',
  'SGD',
  'LKR',
] as const;

/**
 * 只给「支付方式」的结算币种下拉用，比 COMMON_CURRENCIES 多一个 CNY——
 * 这是支付宝背后真正扣款的币种，但不该出现在旅程币种/记账币种/钱包币种
 * 的选择里（不会真的持有人民币现金，也不会拿它当行程记账币种）。
 */
export const PAYMENT_METHOD_SETTLEMENT_CURRENCIES = [...COMMON_CURRENCIES, 'CNY'] as const;
