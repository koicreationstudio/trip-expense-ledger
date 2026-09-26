import { describe, expect, it } from 'vitest';
import { matchesAmountRange, matchesAmountExact, parseAmountYuanInput } from './expense-amount-filter';

describe('matchesAmountRange', () => {
  it('两端都没填（min/max 都是 null）时全部放行，即使没有换算值', () => {
    expect(matchesAmountRange({ amountCents: 5000, convertedCents: null }, { minCents: null, maxCents: null })).toBe(
      true
    );
  });

  it('落在区间内命中', () => {
    expect(
      matchesAmountRange({ amountCents: 5000, convertedCents: 8000 }, { minCents: 5000, maxCents: 10000 })
    ).toBe(true);
  });

  it('正好等于最低边界（闭区间）算命中', () => {
    expect(matchesAmountRange({ amountCents: 5000, convertedCents: 5000 }, { minCents: 5000, maxCents: null })).toBe(
      true
    );
  });

  it('正好等于最高边界（闭区间）算命中', () => {
    expect(matchesAmountRange({ amountCents: 5000, convertedCents: 10000 }, { minCents: null, maxCents: 10000 })).toBe(
      true
    );
  });

  it('比最低边界小 1 分不命中', () => {
    expect(matchesAmountRange({ amountCents: 5000, convertedCents: 4999 }, { minCents: 5000, maxCents: null })).toBe(
      false
    );
  });

  it('比最高边界大 1 分不命中', () => {
    expect(matchesAmountRange({ amountCents: 5000, convertedCents: 10001 }, { minCents: null, maxCents: 10000 })).toBe(
      false
    );
  });

  it('只填了最低，没填最高——大于等于最低都命中', () => {
    expect(matchesAmountRange({ amountCents: 0, convertedCents: 999999 }, { minCents: 5000, maxCents: null })).toBe(
      true
    );
  });

  it('只填了最高，没填最低——0 或负值也可能命中，只要不超过最高', () => {
    expect(matchesAmountRange({ amountCents: 0, convertedCents: 0 }, { minCents: null, maxCents: 10000 })).toBe(true);
  });

  it('开了区间筛选（min 或 max 任一非 null）但这笔没有换算值——保守排除，不当作命中', () => {
    expect(matchesAmountRange({ amountCents: 5000, convertedCents: null }, { minCents: 1000, maxCents: null })).toBe(
      false
    );
    expect(matchesAmountRange({ amountCents: 5000, convertedCents: null }, { minCents: null, maxCents: 100000 })).toBe(
      false
    );
  });
});

describe('matchesAmountExact', () => {
  it('原始记账金额（原币种）等于目标值——命中', () => {
    expect(matchesAmountExact({ amountCents: 12345, convertedCents: 6789 }, 12345)).toBe(true);
  });

  it('换算参考值等于目标值——命中（填折算后看到的数字也能找到这笔）', () => {
    expect(matchesAmountExact({ amountCents: 12345, convertedCents: 6789 }, 6789)).toBe(true);
  });

  it('两个都不等于目标值——不命中', () => {
    expect(matchesAmountExact({ amountCents: 12345, convertedCents: 6789 }, 111)).toBe(false);
  });

  it('没有换算值（null）时只看原始金额那一路', () => {
    expect(matchesAmountExact({ amountCents: 12345, convertedCents: null }, 12345)).toBe(true);
    expect(matchesAmountExact({ amountCents: 12345, convertedCents: null }, 6789)).toBe(false);
  });

  it('原始金额和换算值刚好相同（同币种记账，比如本位币本身）——命中一次不受影响', () => {
    expect(matchesAmountExact({ amountCents: 5000, convertedCents: 5000 }, 5000)).toBe(true);
  });
});

describe('parseAmountYuanInput——四舍五入到分的边界情况', () => {
  it('空字符串/纯空白返回 null（代表"没填"，不是 0）', () => {
    expect(parseAmountYuanInput('')).toBeNull();
    expect(parseAmountYuanInput('   ')).toBeNull();
  });

  it('无法解析成数字返回 null', () => {
    expect(parseAmountYuanInput('abc')).toBeNull();
    expect(parseAmountYuanInput('12.34.56')).toBeNull();
  });

  it('整数元数正常转成分', () => {
    expect(parseAmountYuanInput('50')).toBe(5000);
  });

  it('0 是合法输入，返回 0（不是 null）', () => {
    expect(parseAmountYuanInput('0')).toBe(0);
  });

  it('两位小数正常转换，不涉及舍入', () => {
    expect(parseAmountYuanInput('18.67')).toBe(1867);
    expect(parseAmountYuanInput('18.66')).toBe(1866);
  });

  it('18.665 四舍五入到 18.67（锁住这个具体值在 IEEE754 下的真实behavior：18.665*100 恰好落在可精确表示的 1866.5，Math.round 向上取整成 1867）', () => {
    expect(parseAmountYuanInput('18.665')).toBe(1867);
  });

  it('1.005 这个经典浮点边界值——1.005*100 在 IEEE754 下实际是 100.49999999999999，Math.round 取整成 100（1.00 元），不是直觉上的 1.01 元；这是继承自 lib/money.ts yuanToCents 的既有行为，这里锁住而不是掩盖', () => {
    expect(parseAmountYuanInput('1.005')).toBe(100);
  });

  it('负数输入也能解析（理论上金额不该为负，但这个函数只负责字符串转分，不做业务校验）', () => {
    expect(parseAmountYuanInput('-5')).toBe(-500);
  });
});
