import { describe, expect, it } from 'vitest';
import { equalSplit } from './split';

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
