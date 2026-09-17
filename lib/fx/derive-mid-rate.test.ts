import { describe, expect, it } from 'vitest';
import { deriveMidRate } from './derive-mid-rate';

describe('deriveMidRate', () => {
  const rates = { MYR: 1, USD: 0.21, HKD: 1.65, THB: 7.6, CNY: 1.53 };

  it('MYR 当 from 时直接返回快照里的值', () => {
    expect(deriveMidRate(rates, 'MYR', 'USD')).toBeCloseTo(0.21);
  });

  it('MYR 当 to 时返回倒数', () => {
    expect(deriveMidRate(rates, 'USD', 'MYR')).toBeCloseTo(1 / 0.21);
  });

  it('两个非 MYR 币种之间靠 MYR 搭桥换算', () => {
    // 1 HKD = ? THB：1 HKD = 1/1.65 MYR，再乘 7.6 = THB
    expect(deriveMidRate(rates, 'HKD', 'THB')).toBeCloseTo(7.6 / 1.65);
  });

  it('from === to 时用同一个 key，比例算出来正好是 1', () => {
    expect(deriveMidRate(rates, 'USD', 'USD')).toBeCloseTo(1);
  });

  it('rates 为 null/undefined 时返回 undefined', () => {
    expect(deriveMidRate(null, 'USD', 'MYR')).toBeUndefined();
    expect(deriveMidRate(undefined, 'USD', 'MYR')).toBeUndefined();
  });

  it('from/to 有一个不在表里时返回 undefined，不抛错', () => {
    expect(deriveMidRate(rates, 'JPY', 'MYR')).toBeUndefined();
    expect(deriveMidRate(rates, 'MYR', 'JPY')).toBeUndefined();
  });

  it('fromRate 为 0（理论上不该出现，但防呆）时返回 undefined 不除以 0', () => {
    expect(deriveMidRate({ MYR: 1, USD: 0 }, 'USD', 'MYR')).toBeUndefined();
  });
});
