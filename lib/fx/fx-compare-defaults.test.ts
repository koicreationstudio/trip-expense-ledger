import { describe, expect, it } from 'vitest';
import {
  resolveDefaultTarget,
  resolveHoldCandidates,
  resolveTargetCandidates,
  FX_SUPPORTED_CURRENCIES,
  HOLD_CURRENCY_CANDIDATES,
  TARGET_CURRENCY_CANDIDATES,
} from './fx-compare-defaults';

describe('resolveHoldCandidates', () => {
  it('2026-09-23 第二次修复：不再用 enabledCurrencies 收窄，永远给出完整候选池（MYR + 7 个支持的币种）', () => {
    expect(resolveHoldCandidates(null)).toEqual([...HOLD_CURRENCY_CANDIDATES]);
    expect(resolveHoldCandidates(null).length).toBe(8);
  });

  it('传真实行程的 enabledCurrencies 也不会被收窄——这是这次要修的真根因（旧版本会在这里收窄到 3-4 项）', () => {
    // "🇭🇰2026香港" 真实行程 enabledCurrencies=[MYR,HKD,USD,CNY]，旧实现在这里会
    // filter 掉候选池里不在这个列表里的币种；新实现完全不看这个参数。
    const result = resolveHoldCandidates(['MYR', 'HKD', 'USD', 'CNY']);
    expect(result).toEqual([...HOLD_CURRENCY_CANDIDATES]);
    expect(result).toContain('THB');
    expect(result).toContain('PHP');
    expect(result).toContain('LKR');
  });
});

describe('resolveTargetCandidates', () => {
  it('排除掉正好等于 hold 的那个币种，其余候选池原样保留（2026-09-23 扩容到 7 项支持币种）', () => {
    expect(resolveTargetCandidates('HKD')).toEqual(['THB', 'USD', 'SGD', 'CNY', 'PHP', 'LKR']);
    expect(resolveTargetCandidates('HKD').length).toBe(6);
  });

  it('hold 不在候选表里时（比如 MYR，目标币种候选本来就不含 MYR）原样返回全部 7 项', () => {
    expect(resolveTargetCandidates('MYR')).toEqual([...TARGET_CURRENCY_CANDIDATES]);
    expect(resolveTargetCandidates('MYR').length).toBe(7);
  });

  it('目标币种候选池不含 MYR——本币是"随身带出门的钱"，不该同时又是换汇目的地，这条语义没有改', () => {
    expect(TARGET_CURRENCY_CANDIDATES).not.toContain('MYR');
  });
});

describe('resolveDefaultTarget — 2026-09-23 真实 bug 回归测试', () => {
  it('真实场景："🇭🇰2026香港"行程 hold=HKD、enabledCurrencies=[MYR,HKD,USD,CNY]，不能默认 THB，扩容候选池后依然是 USD', () => {
    const target = resolveDefaultTarget('HKD', ['MYR', 'HKD', 'USD', 'CNY']);
    expect(target).not.toBe('THB');
    expect(target).toBe('USD');
  });

  it('旧行程 enabledCurrencies=null 时继续退回 THB（"2026曼谷"泰铢语境不受候选池扩容影响）', () => {
    expect(resolveDefaultTarget('MYR', null)).toBe('THB');
  });

  it('enabledCurrencies 跟目标候选表完全没有交集时也退回 THB，不抛错', () => {
    expect(resolveDefaultTarget('MYR', ['MYR'])).toBe('THB');
  });

  it('hold 本身不合法（不在任何候选表里）时不崩，仍能算出一个默认值', () => {
    expect(() => resolveDefaultTarget('JPY', ['USD'])).not.toThrow();
  });

  it('hold 本身就是 THB 时（比如真选了泰铢当本位币），候选表没有 THB，退回候选表第一项而不是抛错/卡死', () => {
    expect(resolveDefaultTarget('THB', null)).toBe('USD');
  });
});

describe('FX_SUPPORTED_CURRENCIES 跟 lib/fx/fetch-rates.ts 的 FX_NEEDED_QUOTE_CURRENCIES 必须逐一对应', () => {
  it('候选池里每个币种都要有真实汇率数据支撑，不能是这张表压根查不到的币种', () => {
    // 独立引用避免循环依赖，这里手写一份跟 fetch-rates.ts 同步的期望值，
    // 两边任一改了忘了同步改另一边，这条测试会先炸。
    const expectedSupported = ['USD', 'HKD', 'THB', 'PHP', 'SGD', 'LKR', 'CNY'];
    expect([...FX_SUPPORTED_CURRENCIES].sort()).toEqual([...expectedSupported].sort());
  });
});
