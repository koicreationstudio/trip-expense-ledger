import { describe, expect, it } from 'vitest';
import { isSameOrder, moveItem } from './reorder';

describe('moveItem', () => {
  it('把第 0 项挪到第 2 项', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('把最后一项挪到最前面', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('挪到自己原来的位置，顺序不变', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  });

  it('下标越界会被夹在合法范围内，不抛错', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 99)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], -5, 1)).toEqual(['b', 'a', 'c']);
  });

  it('空数组直接返回空数组', () => {
    expect(moveItem([], 0, 1)).toEqual([]);
  });

  it('不改动传入的原数组（返回新数组）', () => {
    const original = ['a', 'b', 'c'];
    const result = moveItem(original, 0, 2);
    expect(original).toEqual(['a', 'b', 'c']);
    expect(result).not.toBe(original);
  });
});

describe('isSameOrder', () => {
  it('完全相同的顺序返回 true', () => {
    expect(isSameOrder(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(true);
  });

  it('顺序不同返回 false', () => {
    expect(isSameOrder(['a', 'b', 'c'], ['a', 'c', 'b'])).toBe(false);
  });

  it('长度不同返回 false', () => {
    expect(isSameOrder(['a', 'b'], ['a', 'b', 'c'])).toBe(false);
  });
});
