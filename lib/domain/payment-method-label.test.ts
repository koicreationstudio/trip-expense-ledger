import { describe, expect, it } from 'vitest';
import { disambiguatePaymentMethodLabels } from './payment-method-label';

describe('disambiguatePaymentMethodLabels', () => {
  it('同名支付方式按结算币种消歧义（Remy 真实"现金"HKD/USD 场景）', () => {
    const methods = [
      { id: 'cash-hkd', label: '现金', settlementCurrency: 'HKD' },
      { id: 'cash-usd', label: '现金', settlementCurrency: 'USD' },
      { id: 'wise', label: 'Wise', settlementCurrency: 'MYR' },
    ];

    const result = disambiguatePaymentMethodLabels(methods);

    expect(result.get('cash-hkd')).toBe('现金（HKD）');
    expect(result.get('cash-usd')).toBe('现金（USD）');
    expect(result.get('wise')).toBe('Wise'); // 唯一的不加后缀，不制造噪音
  });

  it('全部 label 唯一时原样返回', () => {
    const methods = [
      { id: 'a', label: 'HSBC 大马 Visa Signature', settlementCurrency: 'MYR' },
      { id: 'b', label: '支付宝', settlementCurrency: 'CNY' },
    ];

    const result = disambiguatePaymentMethodLabels(methods);

    expect(result.get('a')).toBe('HSBC 大马 Visa Signature');
    expect(result.get('b')).toBe('支付宝');
  });

  it('三个以上同名也能正确消歧义（不是只处理两个的特例）', () => {
    const methods = [
      { id: '1', label: '现金', settlementCurrency: 'HKD' },
      { id: '2', label: '现金', settlementCurrency: 'USD' },
      { id: '3', label: '现金', settlementCurrency: 'CNY' },
    ];

    const result = disambiguatePaymentMethodLabels(methods);

    expect(result.get('1')).toBe('现金（HKD）');
    expect(result.get('2')).toBe('现金（USD）');
    expect(result.get('3')).toBe('现金（CNY）');
  });

  it('消歧义范围只看传进来的这一组，不是全局唯一（调用方各自查子集是有意的设计）', () => {
    // 只传了其中一个"现金"，这一组里它就是唯一的，不该被加后缀
    const methods = [{ id: 'cash-hkd', label: '现金', settlementCurrency: 'HKD' }];

    const result = disambiguatePaymentMethodLabels(methods);

    expect(result.get('cash-hkd')).toBe('现金');
  });

  it('空数组不报错，返回空 map', () => {
    expect(disambiguatePaymentMethodLabels([]).size).toBe(0);
  });
});
