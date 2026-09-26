import { describe, expect, it } from 'vitest';
import { isOnlyMeSplit } from './expense-split-mode';

describe('isOnlyMeSplit', () => {
  it('只有付款人一人：true', () => {
    expect(isOnlyMeSplit(['p1'], 'p1')).toBe(true);
  });

  it('有付款人 + 别人：false', () => {
    expect(isOnlyMeSplit(['p1', 'p2'], 'p1')).toBe(false);
  });

  it('只有别人，没有付款人（理论上不该出现，但行为要确定）：false', () => {
    expect(isOnlyMeSplit(['p2'], 'p1')).toBe(false);
  });

  it('空数组：false', () => {
    expect(isOnlyMeSplit([], 'p1')).toBe(false);
  });
});
