// @vitest-environment jsdom
/**
 * 第七十一轮任务⑤⑥：活动流拖拽重排 + 排序/筛选云端同步。
 *
 * 拖拽本身（指针捕获/长按计时器/真实 DOM 测量）只能真机走查，jsdom 里
 * `getBoundingClientRect` 永远返回 0，测不出真实的"拖到哪一行"这种几何判断——
 * 这个文件只锁住能在 jsdom 里可靠断言的部分：①manual 排序模式下渲染顺序确实按
 * `sortOrder` 来，不是 props 数组的原始顺序 ②拖拽手柄只在"手动排序 + 没有筛选"
 * 时出现，筛选中或者切到日期/金额排序时手柄消失 ③排序/筛选偏好云端同步照抄
 * fx-compare-card.tsx 的"零交互不 PUT"回归测试模式。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { ExpenseList, type ExpenseListItem } from './expense-list';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TRIP_ID = 'trip-round71-test';
const MY_ID = 'p1';

function makeExpense(overrides: Partial<ExpenseListItem>): ExpenseListItem {
  return {
    id: 'e1',
    category: '🍜 餐饮',
    merchant: null,
    amount: 1000,
    currency: 'MYR',
    amountBaseCurrency: 1000,
    amountMyr: null,
    expenseDate: '2026-09-01T00:00:00.000Z',
    hasReceipt: false,
    payerName: '我',
    enteredByParticipantId: MY_ID,
    paymentMethodLabel: null,
    excludeFromSplit: false,
    sortOrder: 0,
    ...overrides,
  };
}

function mockFetch(putSpy: (url: string, body: string) => void, preference: unknown = null) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.includes('/expense-list-preference') && method === 'GET') {
      return new Response(JSON.stringify({ preference }), { status: 200 });
    }
    if (url.includes('/expense-list-preference') && method === 'PUT') {
      putSpy(url, String(init?.body ?? ''));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    throw new Error(`未预期的请求：${method} ${url}`);
  });
}

describe('ExpenseList — 任务⑤：manual 排序按 sortOrder 渲染，不是 props 原始顺序', () => {
  it('props 顺序是 A,B,C，但 sortOrder 是 C,A,B，展示应该按 sortOrder 来', () => {
    vi.stubGlobal('fetch', mockFetch(vi.fn()));
    const expenses = [
      makeExpense({ id: 'A', merchant: 'A店', sortOrder: 1 }),
      makeExpense({ id: 'B', merchant: 'B店', sortOrder: 2 }),
      makeExpense({ id: 'C', merchant: 'C店', sortOrder: 0 }),
    ];
    render(<ExpenseList tripId={TRIP_ID} expenses={expenses} myParticipantId={MY_ID} baseCurrency="MYR" />);

    const names = screen.getAllByText(/店$/).map((el) => el.textContent);
    expect(names).toEqual(['C店', 'A店', 'B店']);
  });
});

describe('ExpenseList — 任务⑤：拖拽手柄只在「手动排序 + 无筛选」时出现', () => {
  it('默认（手动排序、无筛选）：拖拽手柄可见', () => {
    vi.stubGlobal('fetch', mockFetch(vi.fn()));
    const expenses = [makeExpense({ id: 'A', merchant: 'A店' })];
    render(<ExpenseList tripId={TRIP_ID} expenses={expenses} myParticipantId={MY_ID} baseCurrency="MYR" />);
    expect(screen.getByLabelText('拖拽调整顺序')).not.toBeNull();
  });

  it('切到「排序：日期」之后，拖拽手柄消失', () => {
    vi.stubGlobal('fetch', mockFetch(vi.fn()));
    const expenses = [makeExpense({ id: 'A', merchant: 'A店' })];
    render(<ExpenseList tripId={TRIP_ID} expenses={expenses} myParticipantId={MY_ID} baseCurrency="MYR" />);
    fireEvent.click(screen.getByLabelText('排序方式'));
    fireEvent.mouseDown(screen.getByRole('option', { name: '排序：日期' }));
    expect(screen.queryByLabelText('拖拽调整顺序')).toBeNull();
  });

  it('开着筛选时，拖拽手柄消失 + 显示提示文案', () => {
    vi.stubGlobal('fetch', mockFetch(vi.fn()));
    const expenses = [
      makeExpense({ id: 'A', merchant: 'A店', category: '🍜 餐饮' }),
      makeExpense({ id: 'B', merchant: 'B店', category: '✈️ 机票' }),
    ];
    render(<ExpenseList tripId={TRIP_ID} expenses={expenses} myParticipantId={MY_ID} baseCurrency="MYR" />);
    fireEvent.click(screen.getByLabelText('按分类筛选'));
    fireEvent.mouseDown(screen.getByRole('option', { name: '🍜 餐饮' }));
    expect(screen.queryByLabelText('拖拽调整顺序')).toBeNull();
    expect(screen.getByText('清除筛选之后才能拖拽调整顺序。')).not.toBeNull();
  });
});

describe('ExpenseList — 任务⑥：排序/筛选偏好云端同步，零交互不 PUT', () => {
  it('挂载 + 从存档恢复偏好之后，1 秒内 0 次 PUT', async () => {
    const putSpy = vi.fn();
    vi.stubGlobal(
      'fetch',
      mockFetch(putSpy, {
        sortMode: 'date',
        categoryFilter: '__all__',
        payerFilter: '__all__',
        dateFilter: '__all__',
        paymentMethodFilter: '__all__',
      })
    );
    const expenses = [makeExpense({ id: 'A', merchant: 'A店' })];
    render(<ExpenseList tripId={TRIP_ID} expenses={expenses} myParticipantId={MY_ID} baseCurrency="MYR" />);

    // 等存档恢复完成（排序应该已经变成"日期"）。
    await waitFor(() => {
      const trigger = screen.getByLabelText('排序方式');
      expect(trigger.textContent).toContain('日期');
    });

    await new Promise((r) => setTimeout(r, 1000));
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('从没保存过偏好（GET 返回 preference:null）时，默认值也不会被当成"变了"倒灌回去，0 次 PUT', async () => {
    // 这是 round66 那类 bug 真正会发生的场景：`lastSavedSnapshotRef` 是 null，
    // 组件默认值（sortMode='manual' 等）显然不等于 null，如果只靠"内容比对"这层
    // 双保险（没有 hasUserInteractedRef 这层拦），会被误判成"内容变了"从而真的
    // PUT 一次——必须靠 hasUserInteractedRef 拦住，光内容比对拦不住这个 case。
    const putSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(putSpy, null));
    const expenses = [makeExpense({ id: 'A', merchant: 'A店' })];
    render(<ExpenseList tripId={TRIP_ID} expenses={expenses} myParticipantId={MY_ID} baseCurrency="MYR" />);

    await new Promise((r) => setTimeout(r, 1000));
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('用户真实切排序方式之后，恰好 1 次 PUT', async () => {
    const putSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(putSpy, null));
    const expenses = [makeExpense({ id: 'A', merchant: 'A店' })];
    render(<ExpenseList tripId={TRIP_ID} expenses={expenses} myParticipantId={MY_ID} baseCurrency="MYR" />);

    fireEvent.click(screen.getByLabelText('排序方式'));
    fireEvent.mouseDown(screen.getByRole('option', { name: '排序：金额' }));

    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    const body = JSON.parse(putSpy.mock.calls[0]![1]);
    expect(body.sortMode).toBe('amount');

    await new Promise((r) => setTimeout(r, 800));
    expect(putSpy).toHaveBeenCalledTimes(1);
  });
});
