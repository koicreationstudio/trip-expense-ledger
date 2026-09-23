import { describe, expect, it } from 'vitest';
import { resolveDefaultTarget, resolveHoldCandidates, resolveTargetCandidates } from './fx-compare-defaults';

describe('resolveHoldCandidates', () => {
  it('enabledCurrencies 为 null 时返回全部 4 个固定基准', () => {
    expect(resolveHoldCandidates(null)).toEqual(['MYR', 'USD', 'HKD', 'CNY']);
  });

  it('enabledCurrencies 收窄成真实启用的那几个（保持固定顺序）', () => {
    expect(resolveHoldCandidates(['MYR', 'HKD', 'USD', 'CNY'])).toEqual(['MYR', 'USD', 'HKD', 'CNY']);
  });
});

describe('resolveTargetCandidates', () => {
  it('排除掉正好等于 hold 的那个币种，其余固定 4 项原样保留', () => {
    expect(resolveTargetCandidates('HKD')).toEqual(['THB', 'USD', 'SGD', 'CNY']);
  });

  it('hold 不在候选表里时（比如 MYR）原样返回全部 5 项', () => {
    expect(resolveTargetCandidates('MYR')).toEqual(['THB', 'USD', 'SGD', 'CNY', 'HKD']);
  });
});

describe('resolveDefaultTarget — 2026-09-23 真实 bug 回归测试', () => {
  it('真实场景："🇭🇰2026香港"行程 hold=HKD、enabledCurrencies=[MYR,HKD,USD,CNY]，不能默认 THB', () => {
    // 这趟真实行程的 enabledCurrencies 从头到尾没有 THB，之前硬编码 useState('THB')
    // 会导致目标币种永远默认显示 THB，这条测试专门钉死"不能再复发"。
    const target = resolveDefaultTarget('HKD', ['MYR', 'HKD', 'USD', 'CNY']);
    expect(target).not.toBe('THB');
    expect(target).toBe('USD'); // resolveTargetCandidates('HKD') = [THB,USD,SGD,CNY]，跟 enabledCurrencies 交集第一个是 USD
  });

  it('旧行程 enabledCurrencies=null 时继续退回固定候选表第一项（"2026曼谷"泰铢语境不受影响）', () => {
    expect(resolveDefaultTarget('MYR', null)).toBe('THB');
  });

  it('enabledCurrencies 跟目标候选表完全没有交集时也退回固定候选表第一项，不抛错', () => {
    expect(resolveDefaultTarget('MYR', ['MYR'])).toBe('THB');
  });

  it('hold 本身不合法（不在任何候选表里）时不崩，仍能算出一个默认值', () => {
    expect(() => resolveDefaultTarget('JPY', ['USD'])).not.toThrow();
  });
});
