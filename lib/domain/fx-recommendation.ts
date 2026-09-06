/**
 * 支付方式比价：给一笔消费算出「用手上哪张卡/现金最划算」的排序列表。
 *
 * 纯函数，汇率查找通过注入的 getMarketRate 完成，不在这里直接打网络请求，
 * 方便单测，也方便调用方决定汇率来源（当日缓存 / 手动输入）。
 * 金额一律用最小货币单位（分）的整数表示。
 */

export interface FxPaymentMethodInput {
  id: string;
  label: string;
  settlementCurrency: string;
  fxMarkupPercent: number;
  foreignTxnFeePercent: number;
  fixedFee: number; // settlementCurrency 的最小货币单位
  cashbackPercent: number;
}

/** 返回 1 单位 from 换算成多少 to；查不到返回 null（不阻塞记账，调用方应兜底走手动输入）。 */
export type FxRateLookup = (from: string, to: string) => number | null;

export interface FxRecommendationResult {
  paymentMethodId: string;
  label: string;
  /** compareCurrency 下的等值成本（最小货币单位），unavailable 时为 null */
  costInCompareCurrency: number | null;
  effectiveRate: number | null;
  requiresConversion: boolean;
  /** 汇率查不到导致无法计算，调用方应提示用户手动输入汇率 */
  unavailable: boolean;
}

export function recommendPaymentMethods(params: {
  /** 消费金额，expenseCurrency 的最小货币单位 */
  amount: number;
  expenseCurrency: string;
  /** 用于排序/展示的统一比较币种，通常是 trip 的 base_currency */
  compareCurrency: string;
  paymentMethods: FxPaymentMethodInput[];
  getMarketRate: FxRateLookup;
}): FxRecommendationResult[] {
  const { amount, expenseCurrency, compareCurrency, paymentMethods, getMarketRate } = params;

  const results = paymentMethods.map((method): FxRecommendationResult => {
    const requiresConversion = method.settlementCurrency !== expenseCurrency;
    let effectiveRate = 1;
    let baseInSettlementCurrency = amount;

    if (requiresConversion) {
      const marketRate = getMarketRate(expenseCurrency, method.settlementCurrency);
      if (marketRate === null) {
        return {
          paymentMethodId: method.id,
          label: method.label,
          costInCompareCurrency: null,
          effectiveRate: null,
          requiresConversion,
          unavailable: true,
        };
      }
      effectiveRate = marketRate * (1 + method.fxMarkupPercent / 100);
      baseInSettlementCurrency = amount * effectiveRate;
    }

    const costInSettlementCurrency =
      baseInSettlementCurrency * (1 + method.foreignTxnFeePercent / 100) -
      baseInSettlementCurrency * (method.cashbackPercent / 100) +
      method.fixedFee;

    let costInCompareCurrency = costInSettlementCurrency;
    if (method.settlementCurrency !== compareCurrency) {
      const displayRate = getMarketRate(method.settlementCurrency, compareCurrency);
      if (displayRate === null) {
        return {
          paymentMethodId: method.id,
          label: method.label,
          costInCompareCurrency: null,
          effectiveRate,
          requiresConversion,
          unavailable: true,
        };
      }
      costInCompareCurrency = costInSettlementCurrency * displayRate;
    }

    return {
      paymentMethodId: method.id,
      label: method.label,
      costInCompareCurrency: Math.round(costInCompareCurrency),
      effectiveRate,
      requiresConversion,
      unavailable: false,
    };
  });

  const available = results
    .filter((r) => !r.unavailable)
    .sort((a, b) => (a.costInCompareCurrency ?? 0) - (b.costInCompareCurrency ?? 0));
  const unavailable = results.filter((r) => r.unavailable);

  return [...available, ...unavailable];
}
