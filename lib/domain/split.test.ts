import { describe, expect, it } from 'vitest';
import { deriveOriginalCurrencyShares, equalSplit, rescaleSplitToBaseCurrency } from './split';

describe('equalSplit', () => {
  it('整除时每人分到相同金额', () => {
    const shares = equalSplit(300, ['A', 'B', 'C']);
    expect(shares).toEqual([
      { participantId: 'A', shareAmountBaseCurrency: 100 },
      { participantId: 'B', shareAmountBaseCurrency: 100 },
      { participantId: 'C', shareAmountBaseCurrency: 100 },
    ]);
  });

  it('除不尽时余数按顺序分给前几个人，总和严格等于原始金额', () => {
    const shares = equalSplit(100, ['A', 'B', 'C']);
    expect(shares).toEqual([
      { participantId: 'A', shareAmountBaseCurrency: 34 },
      { participantId: 'B', shareAmountBaseCurrency: 33 },
      { participantId: 'C', shareAmountBaseCurrency: 33 },
    ]);
    const total = shares.reduce((sum, s) => sum + s.shareAmountBaseCurrency, 0);
    expect(total).toBe(100);
  });

  it('单人行程全部由自己承担', () => {
    expect(equalSplit(500, ['A'])).toEqual([{ participantId: 'A', shareAmountBaseCurrency: 500 }]);
  });

  it('没有参与者时抛错，不能悄悄返回空数组丢掉这笔钱', () => {
    expect(() => equalSplit(100, [])).toThrow();
  });
});

describe('rescaleSplitToBaseCurrency', () => {
  it('无汇率换算时（原始币种就是本位币）原样保留每人金额', () => {
    const shares = rescaleSplitToBaseCurrency(
      [
        { participantId: 'A', amountNativeCents: 1000 },
        { participantId: 'B', amountNativeCents: 2000 },
      ],
      3000
    );
    expect(shares).toEqual([
      { participantId: 'A', shareAmountBaseCurrency: 1000 },
      { participantId: 'B', shareAmountBaseCurrency: 2000 },
    ]);
  });

  it('按比例换算汇率后用最大余数法分零头，总和严格等于 amountBaseCurrency', () => {
    // 原始分摊 500/300/200（总 1000），换算成本位币总额 333（不能整除）
    const shares = rescaleSplitToBaseCurrency(
      [
        { participantId: 'A', amountNativeCents: 500 },
        { participantId: 'B', amountNativeCents: 300 },
        { participantId: 'C', amountNativeCents: 200 },
      ],
      333
    );
    expect(shares).toEqual([
      { participantId: 'A', shareAmountBaseCurrency: 166 },
      { participantId: 'B', shareAmountBaseCurrency: 100 },
      { participantId: 'C', shareAmountBaseCurrency: 67 },
    ]);
    const total = shares.reduce((sum, s) => sum + s.shareAmountBaseCurrency, 0);
    expect(total).toBe(333);
  });

  it('单人承担全部时不管比例，金额就是换算后的总额', () => {
    const shares = rescaleSplitToBaseCurrency([{ participantId: 'A', amountNativeCents: 500 }], 1234);
    expect(shares).toEqual([{ participantId: 'A', shareAmountBaseCurrency: 1234 }]);
  });

  it('未参与分摊的人金额是 0，换算后仍是 0，不会凭空多出钱', () => {
    const shares = rescaleSplitToBaseCurrency(
      [
        { participantId: 'A', amountNativeCents: 1000 },
        { participantId: 'B', amountNativeCents: 0 },
      ],
      500
    );
    expect(shares).toEqual([
      { participantId: 'A', shareAmountBaseCurrency: 500 },
      { participantId: 'B', shareAmountBaseCurrency: 0 },
    ]);
  });

  it('没有参与者时抛错', () => {
    expect(() => rescaleSplitToBaseCurrency([], 100)).toThrow();
  });

  it('总分摊金额为 0 时抛错，不能除以 0', () => {
    expect(() =>
      rescaleSplitToBaseCurrency([{ participantId: 'A', amountNativeCents: 0 }], 100)
    ).toThrow();
  });
});

describe('deriveOriginalCurrencyShares', () => {
  it('汇率为 1（原始币种就是本位币）时原样保留每人金额', () => {
    const shares = deriveOriginalCurrencyShares(
      [
        { participantId: 'A', shareAmountBaseCurrency: 100 },
        { participantId: 'B', shareAmountBaseCurrency: 100 },
      ],
      200,
      200
    );
    expect(shares).toEqual([
      { participantId: 'A', shareAmountOriginal: 100 },
      { participantId: 'B', shareAmountOriginal: 100 },
    ]);
  });

  it('三人平分且原始金额是奇数分时，最大余数法保证总和严格等于原始金额（不丢钱）', () => {
    // 三人平分 333（本位币，MYR->HKD 汇率约 0.514），原始币种总额 647（奇数分，
    // 除不尽），不能用"每份各自四舍五入"，否则总和会跟 647 对不上。
    const splits = [
      { participantId: 'A', shareAmountBaseCurrency: 111 },
      { participantId: 'B', shareAmountBaseCurrency: 111 },
      { participantId: 'C', shareAmountBaseCurrency: 111 },
    ];
    const shares = deriveOriginalCurrencyShares(splits, 333, 647);
    const total = shares.reduce((sum, s) => sum + s.shareAmountOriginal, 0);
    expect(total).toBe(647);
  });

  it('单人承担全部时不管比例，原始金额就是换算后的总额', () => {
    const shares = deriveOriginalCurrencyShares([{ participantId: 'A', shareAmountBaseCurrency: 1234 }], 1234, 5678);
    expect(shares).toEqual([{ participantId: 'A', shareAmountOriginal: 5678 }]);
  });

  it('未参与分摊的人（本位币份额是 0）反推的原始币种份额仍是 0', () => {
    const shares = deriveOriginalCurrencyShares(
      [
        { participantId: 'A', shareAmountBaseCurrency: 500 },
        { participantId: 'B', shareAmountBaseCurrency: 0 },
      ],
      500,
      963
    );
    expect(shares).toEqual([
      { participantId: 'A', shareAmountOriginal: 963 },
      { participantId: 'B', shareAmountOriginal: 0 },
    ]);
    const total = shares.reduce((sum, s) => sum + s.shareAmountOriginal, 0);
    expect(total).toBe(963);
  });

  it('大量随机金额/人数场景下，总和永远严格等于原始金额，一分钱不丢也不多（锁住"取整/余数分配不能丢钱"这条规矩）', () => {
    // 固定种子的伪随机（不依赖外部库），跑 200 组随机场景，参与者数 1~8，
    // 本位币份额随机但总和固定，原始币种总额也随机——只断言总和精确对得上。
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let trial = 0; trial < 200; trial++) {
      const participantCount = 1 + Math.floor(rand() * 8);
      const shares = Array.from({ length: participantCount }, (_, i) => ({
        participantId: `P${i}`,
        shareAmountBaseCurrency: 1 + Math.floor(rand() * 1000),
      }));
      const amountBaseCurrency = shares.reduce((sum, s) => sum + s.shareAmountBaseCurrency, 0);
      const amountOriginal = 1 + Math.floor(rand() * 100000);

      const result = deriveOriginalCurrencyShares(shares, amountBaseCurrency, amountOriginal);
      const total = result.reduce((sum, s) => sum + s.shareAmountOriginal, 0);
      expect(total).toBe(amountOriginal);
      // 每一份都不能是负数——比例分配 + 补余数不应该产生负份额。
      expect(result.every((s) => s.shareAmountOriginal >= 0)).toBe(true);
    }
  });

  it('没有参与者时抛错', () => {
    expect(() => deriveOriginalCurrencyShares([], 100, 200)).toThrow();
  });

  it('amountBaseCurrency 为 0 时抛错，不能除以 0', () => {
    expect(() =>
      deriveOriginalCurrencyShares([{ participantId: 'A', shareAmountBaseCurrency: 0 }], 0, 100)
    ).toThrow();
  });
});
