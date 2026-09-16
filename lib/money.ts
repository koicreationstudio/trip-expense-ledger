/**
 * 页面上金额一律用户输入/展示"元"，提交给 API 前才转成最小货币单位（分）的整数，
 * 后端契约（schema/DTO）永远只认整数分，这层转换只活在 UI。
 */
export function yuanToCents(yuan: number): number {
  return Math.round(yuan * 100);
}

export function centsToYuan(cents: number): number {
  return cents / 100;
}

/**
 * narrowSymbol 对大部分币种够用（MYR→RM、THB→฿、PHP→₱、CNY→¥、LKR→Rs，一眼就认得出
 * 是哪个币种），但 USD/HKD/SGD 这三个narrowSymbol 全部退化成裸的"$"，三个币种混记在
 * 同一趟行程（比如香港行程本位币 HKD、又刷了美金卡）时金额会分不清是哪一种——这是
 * 2026-09-16 第十七轮 Remy 真实反馈的问题（"$60.50"看不出是港币还是美金）。
 * 只对这三个会跟"$"撞车的币种改用更明确的前缀，其它币种不动（narrowSymbol 已经够清楚，
 * 换成 ISO 代码反而会把 "RM"/"฿" 这种更好认的显示退化成生硬的 "MYR"/"THB"）。
 */
const AMBIGUOUS_DOLLAR_PREFIX: Record<string, string> = {
  USD: 'US$',
  HKD: 'HK$',
  SGD: 'S$',
};

export function formatMoney(cents: number, currency: string): string {
  const formatted = new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  }).format(centsToYuan(cents));
  const prefix = AMBIGUOUS_DOLLAR_PREFIX[currency];
  // narrowSymbol 对这三个币种在 zh-CN locale 下永远只输出裸"$"（正负数都一样，
  // "-$1,234.50" 也只有一个 "$"），直接替换第一个 "$" 不会误伤其它字符。
  return prefix ? formatted.replace('$', prefix) : formatted;
}

// Hero 卡水印用：只取货币符号本身（跟 formatMoney 同一套前缀消歧逻辑，不是另起一份符号表）。
export function getCurrencySymbol(currency: string): string {
  const prefix = AMBIGUOUS_DOLLAR_PREFIX[currency];
  if (prefix) return prefix;
  const part = new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  })
    .formatToParts(0)
    .find((p) => p.type === 'currency');
  return part?.value ?? currency;
}
