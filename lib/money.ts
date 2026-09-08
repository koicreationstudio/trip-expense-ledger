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

export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  }).format(centsToYuan(cents));
}

// Hero 卡水印用：只取货币符号本身（跟 formatMoney 同一套 Intl 格式化逻辑，不是另起一份符号表）。
export function getCurrencySymbol(currency: string): string {
  const part = new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  })
    .formatToParts(0)
    .find((p) => p.type === 'currency');
  return part?.value ?? currency;
}
