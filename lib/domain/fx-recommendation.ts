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
  // fix(2026-09-24，Remy 真实反馈的真 bug)：卡片渲染那边（fx-compare-card.tsx）
  // 一直没有区分"现金支付"跟"刷卡支付"，硬编码文案统一写死"刷卡支付"——连
  // 现金也被这么标。这里把 kind 原样带进结果，UI 层自己决定文案，不在这个纯
  // 领域函数里判断怎么显示（这个函数不管展示，只管算钱）。
  kind: 'card' | 'cash';
  settlementCurrency: string;
  fxMarkupPercent: number;
  foreignTxnFeePercent: number;
  fixedFee: number; // settlementCurrency 的最小货币单位
  cashbackPercent: number;
}

/**
 * 现金换汇（拿现金去换钱店换成当地币）的默认损耗百分比，也是汇率比价渠道组
 * 「换钱店」那一项的点差，两处共用这一个数。现金支付方式没填加点（0）时按它估算，
 * 否则 0% 会被当成零损耗中间价，跟刷卡比永远"最划算"（2026-09-24 Remy 实测反馈）。
 */
export const DEFAULT_CASH_EXCHANGE_MARKUP_PERCENT = 2.512;

/** 返回 1 单位 from 换算成多少 to；查不到返回 null（不阻塞记账，调用方应兜底走手动输入）。 */
export type FxRateLookup = (from: string, to: string) => number | null;

export interface FxRecommendationResult {
  paymentMethodId: string;
  label: string;
  kind: 'card' | 'cash';
  // fix(2026-09-25，任务③"我持有≠本位币也要列出结算币种匹配的支付方式")：
  // 原样带回这张支付方式自己的结算币种，调用方（fx-compare-card.tsx）要拿这个
  // 去跟"我持有"比对，筛出"结算币种===我持有"的那几张卡——之前这个字段完全没
  // 传出来，前端没办法在不额外查一次支付方式列表的情况下做这个筛选。
  settlementCurrency: string;
  /** compareCurrency 下的等值成本（最小货币单位），unavailable 时为 null */
  costInCompareCurrency: number | null;
  effectiveRate: number | null;
  requiresConversion: boolean;
  /** 现金换汇没填实际加点，按 DEFAULT_CASH_EXCHANGE_MARKUP_PERCENT 估算的 */
  cashMarkupEstimated?: boolean;
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
    let cashMarkupEstimated = false;

    if (requiresConversion) {
      const marketRate = getMarketRate(expenseCurrency, method.settlementCurrency);
      if (marketRate === null) {
        return {
          paymentMethodId: method.id,
          label: method.label,
          kind: method.kind,
          settlementCurrency: method.settlementCurrency,
          costInCompareCurrency: null,
          effectiveRate: null,
          requiresConversion,
          unavailable: true,
        };
      }
      cashMarkupEstimated = method.kind === 'cash' && method.fxMarkupPercent === 0;
      const markupPercent = cashMarkupEstimated ? DEFAULT_CASH_EXCHANGE_MARKUP_PERCENT : method.fxMarkupPercent;
      effectiveRate = marketRate * (1 + markupPercent / 100);
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
          kind: method.kind,
          settlementCurrency: method.settlementCurrency,
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
      kind: method.kind,
      settlementCurrency: method.settlementCurrency,
      costInCompareCurrency: Math.round(costInCompareCurrency),
      effectiveRate,
      requiresConversion,
      cashMarkupEstimated,
      unavailable: false,
    };
  });

  const available = results
    .filter((r) => !r.unavailable)
    .sort((a, b) => (a.costInCompareCurrency ?? 0) - (b.costInCompareCurrency ?? 0));
  const unavailable = results.filter((r) => r.unavailable);

  return [...available, ...unavailable];
}
