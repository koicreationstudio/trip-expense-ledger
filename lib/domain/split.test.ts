import { describe, expect, it } from 'vitest';
import { equalSplit, rescaleSplitToBaseCurrency } from './split';

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
