import { describe, expect, it } from 'vitest';
import { isSameExpenseListPreference, type ExpenseListPreferenceSnapshot } from './expense-list-preference-diff';

const BASE: ExpenseListPreferenceSnapshot = {
  sortMode: 'manual',
  categoryFilter: '__all__',
  payerFilter: '__all__',
  dateFilter: '__all__',
  paymentMethodFilter: '__all__',
  splitFilter: 'ALL',
};

describe('isSameExpenseListPreference', () => {
  it('两边都是 null 视为相同', () => {
    expect(isSameExpenseListPreference(null, null)).toBe(true);
  });

  it('一边 null 一边有值一定是"变了"', () => {
    expect(isSameExpenseListPreference(null, BASE)).toBe(false);
    expect(isSameExpenseListPreference(BASE, null)).toBe(false);
  });

  it('完全相同的 6 个字段返回 true', () => {
    expect(isSameExpenseListPreference(BASE, { ...BASE })).toBe(true);
  });

  // 第七十二轮任务④新增字段
  it('splitFilter 不同返回 false', () => {
    expect(isSameExpenseListPreference(BASE, { ...BASE, splitFilter: 'included' })).toBe(false);
    expect(isSameExpenseListPreference(BASE, { ...BASE, splitFilter: 'excluded' })).toBe(false);
  });

  it('sortMode 不同返回 false', () => {
    expect(isSameExpenseListPreference(BASE, { ...BASE, sortMode: 'date' })).toBe(false);
  });

  it('任一筛选条件不同返回 false', () => {
    expect(isSameExpenseListPreference(BASE, { ...BASE, categoryFilter: '🍜 餐饮' })).toBe(false);
    expect(isSameExpenseListPreference(BASE, { ...BASE, payerFilter: 'Remy' })).toBe(false);
    expect(isSameExpenseListPreference(BASE, { ...BASE, dateFilter: '2026-09-15' })).toBe(false);
    expect(isSameExpenseListPreference(BASE, { ...BASE, paymentMethodFilter: '现金HKD' })).toBe(false);
  });
});
