import { describe, expect, it } from 'vitest';
import { findBestOfferIndex, findBestCardOfferGlobalIndex } from './fx-best-offer';

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

describe('findBestCardOfferGlobalIndex', () => {
  it('渠道换汇排第一(数字上最划算)也不该拿徽章，徽章必须落在「我的支付方式」里排最前的那张卡', () => {
    // 场景：全局按 effectiveRate 降序排好（fx-compare-card.tsx 真实排序方式），
    // Wise 渠道数字最好但只是参考估算值，不是 Remy 手上真有的付款方式——徽章该
    // 落在真正的卡（globalIndex=1 那张），不是 globalIndex=0 的渠道行。
    const rows = [
      { key: 'channel-wise', kind: 'channel' as const, requiresConversion: true, globalIndex: 0 },
      { key: 'card-hsbc', kind: 'card' as const, requiresConversion: true, globalIndex: 1 },
      { key: 'card-cash', kind: 'card' as const, requiresConversion: true, globalIndex: 2 },
    ];

    expect(findBestCardOfferGlobalIndex(rows)).toBe(1);
  });

  it('卡片子集里第一张是同币种不需要换汇，要跳过它找下一张真正经过换汇的卡（globalIndex 不是子集内下标）', () => {
    const rows = [
      { key: 'channel-wise', kind: 'channel' as const, requiresConversion: true, globalIndex: 0 },
      { key: 'card-cash-usd', kind: 'card' as const, requiresConversion: false, globalIndex: 1 }, // 同币种，没资格
      { key: 'channel-atm', kind: 'channel' as const, requiresConversion: true, globalIndex: 2 },
      { key: 'card-hsbc', kind: 'card' as const, requiresConversion: true, globalIndex: 3 }, // 真正有资格的卡
    ];

    // 期望返回 3（card-hsbc 的 globalIndex），不是 1（子集内下标）也不是 0（渠道抢先）。
    expect(findBestCardOfferGlobalIndex(rows)).toBe(3);
  });

  it('一张卡都没有(比如没配置支付方式，只有渠道行)时返回 -1，渠道行永远不会被选中', () => {
    const rows = [
      { key: 'channel-wise', kind: 'channel' as const, requiresConversion: true, globalIndex: 0 },
      { key: 'channel-atm', kind: 'channel' as const, requiresConversion: true, globalIndex: 1 },
    ];

    expect(findBestCardOfferGlobalIndex(rows)).toBe(-1);
  });

  it('所有卡都不合资格(同币种或 unavailable)时返回 -1，不会退而求其次选渠道', () => {
    const rows = [
      { key: 'channel-wise', kind: 'channel' as const, requiresConversion: true, globalIndex: 0 },
      { key: 'card-cash-usd', kind: 'card' as const, requiresConversion: false, globalIndex: 1 },
      { key: 'card-broken', kind: 'card' as const, requiresConversion: true, unavailable: true, globalIndex: 2 },
    ];

    expect(findBestCardOfferGlobalIndex(rows)).toBe(-1);
  });
});
