import { describe, expect, it } from 'vitest';
import { recommendPaymentMethods } from './fx-recommendation';
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
        settlementCurrency: 'MYR',
        fxMarkupPercent: 0,
        foreignTxnFeePercent: 0,
        fixedFee: 0,
        cashbackPercent: 0,
      },
      {
        id: 'card',
        label: '信用卡',
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
        settlementCurrency: 'MYR',
        fxMarkupPercent: 0,
        foreignTxnFeePercent: 0,
        fixedFee: 0,
        cashbackPercent: 0,
      },
      {
        id: 'jpy-card',
        label: '日元卡',
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
});
