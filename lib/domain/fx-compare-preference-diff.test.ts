import { describe, expect, it } from 'vitest';
import { isSameFxComparePreference, type FxComparePreferenceSnapshot } from './fx-compare-preference-diff';

const base: FxComparePreferenceSnapshot = {
  holdCurrency: 'HKD',
  targetCurrency: 'THB',
  enabledCompareKeys: ['channel:wise', 'channel:tng', 'card:abc'],
  amountYuan: 1000,
};

describe('isSameFxComparePreference', () => {
  it('相同内容、相同顺序 → 相同', () => {
    expect(isSameFxComparePreference(base, { ...base })).toBe(true);
  });

  it('相同内容、不同顺序（Set 转数组时插入顺序不同）→ 仍然相同，不能按顺序误判', () => {
    const reordered: FxComparePreferenceSnapshot = {
      ...base,
      enabledCompareKeys: ['card:abc', 'channel:tng', 'channel:wise'],
    };
    expect(isSameFxComparePreference(base, reordered)).toBe(true);
  });

  it('holdCurrency 不同 → 不同', () => {
    expect(isSameFxComparePreference(base, { ...base, holdCurrency: 'MYR' })).toBe(false);
  });

  it('targetCurrency 不同 → 不同', () => {
    expect(isSameFxComparePreference(base, { ...base, targetCurrency: 'USD' })).toBe(false);
  });

  it('amountYuan 不同 → 不同', () => {
    expect(isSameFxComparePreference(base, { ...base, amountYuan: 500 })).toBe(false);
  });

  it('enabledCompareKeys 多了一项（比如新卡默认勾选）→ 不同', () => {
    expect(
      isSameFxComparePreference(base, { ...base, enabledCompareKeys: [...base.enabledCompareKeys, 'card:new'] })
    ).toBe(false);
  });

  it('enabledCompareKeys 少了一项 → 不同', () => {
    expect(isSameFxComparePreference(base, { ...base, enabledCompareKeys: ['channel:wise', 'channel:tng'] })).toBe(
      false
    );
  });

  it('两边都是 null → 相同（都还没有存档，不用写）', () => {
    expect(isSameFxComparePreference(null, null)).toBe(true);
  });

  it('一边 null 一边有值 → 不同（第一次真实写入必须放行）', () => {
    expect(isSameFxComparePreference(null, base)).toBe(false);
    expect(isSameFxComparePreference(base, null)).toBe(false);
  });

  it('enabledCompareKeys 有重复项不影响集合比较', () => {
    const withDup: FxComparePreferenceSnapshot = {
      ...base,
      enabledCompareKeys: ['channel:wise', 'channel:wise', 'channel:tng', 'card:abc'],
    };
    expect(isSameFxComparePreference(base, withDup)).toBe(true);
  });
});
