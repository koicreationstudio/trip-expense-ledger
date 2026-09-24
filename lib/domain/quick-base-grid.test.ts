import { describe, it, expect } from 'vitest';
import { quickBaseGridClassName } from './quick-base-grid';

describe('quickBaseGridClassName（第六十六轮 bug G）', () => {
  it('0 或 1 张：单列，不会出现拉伸问题（没有第二个 item 可比较）', () => {
    expect(quickBaseGridClassName(0)).toBe('grid grid-cols-1 gap-[6px]');
    expect(quickBaseGridClassName(1)).toBe('grid grid-cols-1 gap-[6px]');
  });

  it('2 张：2 列一排，同宽', () => {
    expect(quickBaseGridClassName(2)).toBe('grid grid-cols-2 gap-[6px]');
  });

  it('3 张：3 列一排，同宽，不会 2+1', () => {
    expect(quickBaseGridClassName(3)).toBe('grid grid-cols-3 gap-[6px]');
  });

  it('4 张（Remy 报的真实 bug 场景）：手机 2×2、桌面 4 列一排，且不是 flex-1 拉伸写法', () => {
    const cls = quickBaseGridClassName(4);
    expect(cls).toBe('grid grid-cols-2 gap-[6px] sm:grid-cols-4');
    expect(cls).not.toContain('flex-1');
  });

  it('5 张以上：固定列宽 auto-fill 自然换行，不是 auto-fit（auto-fit 会把孤儿行拉伸）', () => {
    const cls = quickBaseGridClassName(5);
    expect(cls).toContain('auto-fill');
    expect(cls).not.toContain('auto-fit');
  });

  it('6 张同样落在 5+ 分支（不是每个数字都要单独列一条，超过 4 就该用自适应换行）', () => {
    expect(quickBaseGridClassName(6)).toBe(quickBaseGridClassName(5));
  });
});
