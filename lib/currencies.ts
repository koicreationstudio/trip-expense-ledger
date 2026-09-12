/** 出差常见币种，够 v0.1 用；不是穷举，用户要的币种不在列表里也可以手动改。 */
export const COMMON_CURRENCIES = [
  'MYR',
  'USD',
  'HKD',
  'THB',
  'PHP',
  'SGD',
  'LKR',
  'CNY',
] as const;

/**
 * CNY 原本（09-08 那版）只放这个支付方式结算币种下拉，没进旅程/记账/钱包的
 * 币种列表，理由是当时觉得不会真的持有人民币现金。09-12 Remy 确认记账和
 * 钱包也需要能选 CNY，所以已经并进 COMMON_CURRENCIES 了。现在这两个常量
 * 是一样的，留着这个名字只是不想动那四个消费点的 import。
 */
export const PAYMENT_METHOD_SETTLEMENT_CURRENCIES = COMMON_CURRENCIES;
