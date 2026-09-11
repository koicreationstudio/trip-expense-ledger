import { describe, expect, it } from 'vitest';
import { computeHomepageSummary } from './homepage-summary';

describe('computeHomepageSummary', () => {
  it('1 个 active + 2 个非 active 行程时不显示摘要（总行程数 3 但进行中只有 1 个，用总数判断会误显示导致跟唯一那张进行中卡片重复）', () => {
    const result = computeHomepageSummary([
      { status: 'active', baseCurrency: 'MYR', netBalance: 100 },
      { status: 'settled', baseCurrency: 'MYR', netBalance: 0 },
      { status: 'archived', baseCurrency: 'THB', netBalance: -50 },
    ]);

    expect(result.showSummary).toBe(false);
    expect(result.activeCount).toBe(1);
  });

  it('0 个 active 行程时不显示摘要', () => {
    const result = computeHomepageSummary([
      { status: 'settled', baseCurrency: 'MYR', netBalance: 0 },
      { status: 'archived', baseCurrency: 'THB', netBalance: -50 },
    ]);

    expect(result.showSummary).toBe(false);
    expect(result.activeCount).toBe(0);
  });

  it('2 个 active 行程时显示摘要，并按币种分组加总净额', () => {
    const result = computeHomepageSummary([
      { status: 'active', baseCurrency: 'MYR', netBalance: 100 },
      { status: 'active', baseCurrency: 'MYR', netBalance: -30 },
      { status: 'active', baseCurrency: 'THB', netBalance: 200 },
      { status: 'settled', baseCurrency: 'MYR', netBalance: 999 },
    ]);

    expect(result.showSummary).toBe(true);
    expect(result.activeCount).toBe(3);
    expect(result.netByCurrency.get('MYR')).toBe(70);
    expect(result.netByCurrency.get('THB')).toBe(200);
  });

  it('空行程列表不显示摘要', () => {
    const result = computeHomepageSummary([]);

    expect(result.showSummary).toBe(false);
    expect(result.activeCount).toBe(0);
    expect(result.netByCurrency.size).toBe(0);
  });
});
