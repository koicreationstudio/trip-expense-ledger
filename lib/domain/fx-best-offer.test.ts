import { describe, expect, it } from 'vitest';
import { findBestOfferIndex } from './fx-best-offer';

describe('findBestOfferIndex', () => {
  it('同币种(无需换汇)那一行即使数字最小也不该拿"最划算"，该落在真正经过换汇的方式里最便宜的那一行', () => {
    // 场景照抄 PM 提出的真实案例：现金 USD 付一笔 USD 计价的消费，0 手续费，
    // costInCompareCurrency 明显比其它需要换汇的方式更低——但因为不需要换汇，
    // 不该参与"最划算"排序竞争。数组已经按 costInCompareCurrency 升序排好
    // （模拟 fx-compare-list.tsx 的真实排序方式），第一个真正有资格的应该是
    // 排第二的"Wise 汇率换汇"，不是排第一的"现金 USD"。
    const rows = [
      { key: 'cash-usd', requiresConversion: false, unavailable: false }, // 同币种，最便宜但没资格
      { key: 'wise', requiresConversion: true, unavailable: false }, // 真正经过换汇里最便宜的
      { key: 'card', requiresConversion: true, unavailable: false },
    ];

    const index = findBestOfferIndex(rows);

    expect(index).toBe(1);
    expect(rows[index]!.key).toBe('wise');
  });

  it('所有行都是同币种时，没有任何一行该拿徽章（返回 -1，天然不命中任何真实下标）', () => {
    const rows = [
      { key: 'cash-usd', requiresConversion: false, unavailable: false },
      { key: 'cash-hkd', requiresConversion: false, unavailable: false },
    ];

    expect(findBestOfferIndex(rows)).toBe(-1);
  });

  it('跳过 unavailable 的行，即使它 requiresConversion 是 true', () => {
    const rows = [
      { key: 'jpy-card', requiresConversion: true, unavailable: true }, // 汇率缺失，不该拿徽章
      { key: 'wise', requiresConversion: true, unavailable: false },
    ];

    expect(findBestOfferIndex(rows)).toBe(1);
  });

  it('没有 unavailable 字段的调用方（fx-compare-card.tsx 的 allRows 形状）视为可用', () => {
    const rows: { key: string; requiresConversion: boolean }[] = [
      { key: 'channel-wise', requiresConversion: true },
      { key: 'card-alipay', requiresConversion: true },
    ];

    expect(findBestOfferIndex(rows)).toBe(0);
  });

  it('第一行本身就有资格时直接返回 0', () => {
    const rows = [
      { key: 'wise', requiresConversion: true, unavailable: false },
      { key: 'cash-usd', requiresConversion: false, unavailable: false },
    ];

    expect(findBestOfferIndex(rows)).toBe(0);
  });
});
