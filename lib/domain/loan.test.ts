import { describe, expect, it } from 'vitest';
import { computeLoanProgress } from './loan';

describe('computeLoanProgress（借款清单还款进度条，round72b）', () => {
  it('还没还任何一笔：unpaid，进度 0%', () => {
    const result = computeLoanProgress(75000, []);
    expect(result).toEqual({
      repaidAmount: 0,
      outstandingAmount: 75000,
      percentRepaid: 0,
      status: 'unpaid',
    });
  });

  it('部分还款一次：partial，百分比精确算出（要求⑥）', () => {
    const result = computeLoanProgress(75000, [{ amount: 15000 }]);
    expect(result.repaidAmount).toBe(15000);
    expect(result.outstandingAmount).toBe(60000);
    expect(result.percentRepaid).toBe(20); // 15000/75000 = 20%
    expect(result.status).toBe('partial');
  });

  it('部分还款多次：正确累加（要求③），不是只看最后一笔', () => {
    const result = computeLoanProgress(75000, [{ amount: 15000 }, { amount: 20000 }, { amount: 5000 }]);
    expect(result.repaidAmount).toBe(40000);
    expect(result.outstandingAmount).toBe(35000);
    expect(result.percentRepaid).toBe(53); // 40000/75000 = 53.33% → 四舍五入 53
    expect(result.status).toBe('partial');
  });

  it('刚好还清：paid，outstanding 精确是 0，不是浮点误差留下的小尾数（要求④）', () => {
    const result = computeLoanProgress(75000, [{ amount: 50000 }, { amount: 25000 }]);
    expect(result.repaidAmount).toBe(75000);
    expect(result.outstandingAmount).toBe(0);
    expect(result.percentRepaid).toBe(100);
    expect(result.status).toBe('paid');
  });

  it('还多了（比如凑整数多还了一点）：outstanding 封顶在 0，不显示"倒欠"负数，百分比封顶 100', () => {
    const result = computeLoanProgress(75000, [{ amount: 80000 }]);
    expect(result.outstandingAmount).toBe(0);
    expect(result.percentRepaid).toBe(100);
    expect(result.status).toBe('paid');
  });

  it('除不尽的百分比按标准四舍五入，不是截断（1/3 → 33% 不是 33.33 或 34）', () => {
    const result = computeLoanProgress(30000, [{ amount: 10000 }]);
    expect(result.percentRepaid).toBe(33);
  });
});
