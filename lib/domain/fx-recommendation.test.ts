import { describe, expect, it } from 'vitest';
import { recommendPaymentMethods, DEFAULT_CASH_EXCHANGE_MARKUP_PERCENT } from './fx-recommendation';
import type { FxPaymentMethodInput, FxRateLookup } from './fx-recommendation';

const noConversionNeeded: FxRateLookup = () => {
  throw new Error('不应该在同币种场景调用汇率查找');
};

describe('recommendPaymentMethods', () => {
  it('同币种时现金(零费率)应该排第一', () => {
    const methods: FxPaymentMethodInput[] = [
      {
        id: 'cash',
        label: '现金',
        kind: 'cash',
        settlementCurrency: 'MYR',
        fxMarkupPercent: 0,
        foreignTxnFeePercent: 0,
        fixedFee: 0,
        cashbackPercent: 0,
      },
      {
        id: 'card',
        label: '信用卡',
        kind: 'card',
        settlementCurrency: 'MYR',
        fxMarkupPercent: 0,
        foreignTxnFeePercent: 1.5,
        fixedFee: 0,
        cashbackPercent: 0,
      },
    ];

    const results = recommendPaymentMethods({
      amount: 10000,
      expenseCurrency: 'MYR',
      compareCurrency: 'MYR',
      paymentMethods: methods,
      getMarketRate: noConversionNeeded,
    });

    expect(results[0]!.paymentMethodId).toBe('cash');
    expect(results[0]!.costInCompareCurrency).toBe(10000);
    expect(results[1]!.costInCompareCurrency).toBe(10150); // +1.5% 手续费
  });

  it('需要换汇时套用汇率加点，成本应高于原始金额乘裸汇率', () => {
    const methods: FxPaymentMethodInput[] = [
      {
        id: 'usd-card',
        label: '境外卡',
        kind: 'card',
        settlementCurrency: 'USD',
        fxMarkupPercent: 2,
        foreignTxnFeePercent: 1,
        fixedFee: 0,
        cashbackPercent: 0,
      },
    ];

    const getMarketRate: FxRateLookup = (from, to) => {
      if (from === 'MYR' && to === 'USD') return 0.21;
      return null;
    };

    const results = recommendPaymentMethods({
      amount: 10000, // 100.00 MYR
      expenseCurrency: 'MYR',
      compareCurrency: 'USD',
      paymentMethods: methods,
      getMarketRate,
    });

    const result = results[0]!;
    // 裸换算: 10000 * 0.21 = 2100；加 2% 汇率加点 -> 2142；再加 1% 手续费 -> 2163.42 -> 四舍五入 2163
    expect(result.costInCompareCurrency).toBe(2163);
    expect(result.unavailable).toBe(false);
  });

  it('返现应该降低成本', () => {
    const methods: FxPaymentMethodInput[] = [
      {
        id: 'cashback-card',
        label: '返现卡',
        kind: 'card',
        settlementCurrency: 'MYR',
        fxMarkupPercent: 0,
        foreignTxnFeePercent: 0,
        fixedFee: 0,
        cashbackPercent: 5,
      },
    ];

    const results = recommendPaymentMethods({
      amount: 10000,
      expenseCurrency: 'MYR',
      compareCurrency: 'MYR',
      paymentMethods: methods,
      getMarketRate: noConversionNeeded,
    });

    expect(results[0]!.costInCompareCurrency).toBe(9500);
  });

  it('固定手续费会被加进成本', () => {
    const methods: FxPaymentMethodInput[] = [
      {
        id: 'flat-fee-card',
        label: '固定手续费卡',
        kind: 'card',
        settlementCurrency: 'MYR',
        fxMarkupPercent: 0,
        foreignTxnFeePercent: 0,
        fixedFee: 500,
        cashbackPercent: 0,
      },
    ];

    const results = recommendPaymentMethods({
      amount: 10000,
      expenseCurrency: 'MYR',
      compareCurrency: 'MYR',
      paymentMethods: methods,
      getMarketRate: noConversionNeeded,
    });

    expect(results[0]!.costInCompareCurrency).toBe(10500);
  });

  it('汇率查不到时该支付方式标记 unavailable，且排在可用结果之后', () => {
    const methods: FxPaymentMethodInput[] = [
      {
        id: 'cash-myr',
        label: '现金',
        kind: 'cash',
        settlementCurrency: 'MYR',
        fxMarkupPercent: 0,
        foreignTxnFeePercent: 0,
        fixedFee: 0,
        cashbackPercent: 0,
      },
      {
        id: 'jpy-card',
        label: '日元卡',
        kind: 'card',
        settlementCurrency: 'JPY',
        fxMarkupPercent: 1,
        foreignTxnFeePercent: 1,
        fixedFee: 0,
        cashbackPercent: 0,
      },
    ];

    const getMarketRate: FxRateLookup = () => null;

    const results = recommendPaymentMethods({
      amount: 10000,
      expenseCurrency: 'MYR',
      compareCurrency: 'MYR',
      paymentMethods: methods,
      getMarketRate,
    });

    expect(results[0]!.paymentMethodId).toBe('cash-myr');
    expect(results[0]!.unavailable).toBe(false);
    expect(results[1]!.paymentMethodId).toBe('jpy-card');
    expect(results[1]!.unavailable).toBe(true);
    expect(results[1]!.costInCompareCurrency).toBeNull();
  });

  // fix(2026-09-24，Remy 真实反馈"支付宝/现金HKD/现金USD 三个算出来的结果完全
  // 一样"，怀疑是换汇计算没按各自结算币种分别算)：用 Remy 真实"🇭🇰2026香港"
  // 行程的真实支付方式配置（支付宝 CNY 结算 / 现金 HKD 结算 / 现金 USD 结算，
  // 三者当时 fx_markup_percent/foreign_txn_fee_percent/fixed_fee/cashback_percent
  // 全部是 0%）+ 真实 exchange_rate_cache 汇率（2026-09-24 查证）手算验证过：
  // 三者数字完全一样不是 bug——是这三个支付方式目前都是 0% 费率，
  // 数学上"结算币种不同但都不收加点/手续费"，换汇之后本来就该收敛到同一个
  // 等值数字（getMarketRate 的跨币种桥接用同一份汇率表，不会因为多绕一手
  // CNY 就凭空产生或消失价值）。这组测试锁死这个结论，同时验证 kind 字段
  // 正确透传、settlementCurrency 确实各自独立参与了计算（不是全部退化成
  // 同一个 fallback 币种）——只要 route.ts 或这个纯函数以后有人不小心把
  // getMarketRate 的参数改错、或者哪个支付方式的 settlementCurrency 被忽略，
  // 这组用真实生产数据算出来的期望值会先炸。
  describe('真实场景：支付宝(CNY结算)/现金(HKD结算)/现金(USD结算)三种支付方式比价', () => {
    // 桥接逻辑照抄 app/api/trips/[tripId]/fx-recommendation/route.ts 的
    // getMarketRate 实现——缓存只存 MYR<->X，非 MYR 两两之间借 MYR 现算。
    const MYR_RATES: Record<string, number> = {
      USD: 0.245444,
      HKD: 1.925142,
      CNY: 1.6508,
    };
    const REVERSE_RATES: Record<string, number> = {
      USD: 4.074249115887942,
      HKD: 0.519442202185605,
      CNY: 0.605766900896535,
    };
    const rateMap = new Map<string, number>();
    for (const [quote, rate] of Object.entries(MYR_RATES)) {
      rateMap.set(`MYR->${quote}`, rate);
      rateMap.set(`${quote}->MYR`, REVERSE_RATES[quote]!);
    }
    const getMarketRate: FxRateLookup = (from, to) => {
      if (from === to) return 1;
      const direct = rateMap.get(`${from}->${to}`);
      if (direct !== undefined) return direct;
      if (from !== 'MYR' && to !== 'MYR') {
        const fromToMyr = rateMap.get(`${from}->MYR`);
        const myrToTarget = rateMap.get(`MYR->${to}`);
        if (fromToMyr !== undefined && myrToTarget !== undefined) return fromToMyr * myrToTarget;
      }
      return null;
    };

    const zeroFeeMethods: FxPaymentMethodInput[] = [
      {
        id: 'alipay',
        label: '支付宝',
        kind: 'card',
        settlementCurrency: 'CNY',
        fxMarkupPercent: 0,
        foreignTxnFeePercent: 0,
        fixedFee: 0,
        cashbackPercent: 0,
      },
      {
        id: 'cash-hkd',
        label: '现金（HKD）',
        kind: 'cash',
        settlementCurrency: 'HKD',
        fxMarkupPercent: 0,
        foreignTxnFeePercent: 0,
        fixedFee: 0,
        cashbackPercent: 0,
      },
      {
        id: 'cash-usd',
        label: '现金（USD）',
        kind: 'cash',
        settlementCurrency: 'USD',
        fxMarkupPercent: 0,
        foreignTxnFeePercent: 0,
        fixedFee: 0,
        cashbackPercent: 0,
      },
    ];

    // 2026-09-24 Remy 拍板改规则：现金需要换汇且没填加点时，不再当零损耗中间价，
    // 按换钱店默认损耗（DEFAULT_CASH_EXCHANGE_MARKUP_PERCENT）估算；卡片和同币种现金不受影响。
    it('0% 费率时：支付宝/同币种现金按中间价，需换汇的现金按换钱店默认损耗估算', () => {
      const results = recommendPaymentMethods({
        amount: 12749, // ≈1000 HKD 换算成 USD notional（分）
        expenseCurrency: 'USD',
        compareCurrency: 'HKD',
        paymentMethods: zeroFeeMethods,
        getMarketRate,
      });

      const byId = new Map(results.map((r) => [r.paymentMethodId, r]));
      expect(byId.get('alipay')!.costInCompareCurrency).toBe(99997);
      expect(byId.get('cash-usd')!.costInCompareCurrency).toBe(99997);
      const cashHkd = byId.get('cash-hkd')!;
      expect(cashHkd.cashMarkupEstimated).toBe(true);
      expect(cashHkd.costInCompareCurrency! / 99997).toBeCloseTo(1 + DEFAULT_CASH_EXCHANGE_MARKUP_PERCENT / 100, 4);
      expect(byId.get('alipay')!.cashMarkupEstimated).toBe(false);
      expect(byId.get('cash-usd')!.cashMarkupEstimated).toBe(false);
      expect(results[results.length - 1]!.paymentMethodId).toBe('cash-hkd');
    });

    it('kind 字段原样透传，不同结算币种各自独立标记是否需要换汇', () => {
      const results = recommendPaymentMethods({
        amount: 12749,
        expenseCurrency: 'USD',
        compareCurrency: 'HKD',
        paymentMethods: zeroFeeMethods,
        getMarketRate,
      });
      const byId = new Map(results.map((r) => [r.paymentMethodId, r]));

      expect(byId.get('alipay')!.kind).toBe('card');
      expect(byId.get('cash-hkd')!.kind).toBe('cash');
      expect(byId.get('cash-usd')!.kind).toBe('cash');

      // 现金 USD 结算币种就是消费币种(USD)本身，不需要经过任何换汇——这是
      // "1:1 无损"的真正含义，requiresConversion 应该是 false；另外两个的
      // 结算币种(CNY/HKD)都不等于消费币种(USD)，需要换汇。
      expect(byId.get('cash-usd')!.requiresConversion).toBe(false);
      expect(byId.get('alipay')!.requiresConversion).toBe(true);
      expect(byId.get('cash-hkd')!.requiresConversion).toBe(true);
    });

    it('现金填了实际加点时用填的数，不再套默认损耗', () => {
      const methods: FxPaymentMethodInput[] = zeroFeeMethods.map((m) =>
        m.id === 'cash-hkd' ? { ...m, fxMarkupPercent: 1 } : m
      );
      const results = recommendPaymentMethods({
        amount: 12749,
        expenseCurrency: 'USD',
        compareCurrency: 'HKD',
        paymentMethods: methods,
        getMarketRate,
      });
      const cashHkd = results.find((r) => r.paymentMethodId === 'cash-hkd')!;
      expect(cashHkd.cashMarkupEstimated).toBe(false);
      expect(cashHkd.costInCompareCurrency! / 99997).toBeCloseTo(1.01, 4);
    });
  });
});
