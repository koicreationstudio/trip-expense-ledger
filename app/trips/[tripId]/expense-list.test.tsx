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
    isOnlyMeSplit: false,
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

describe('ExpenseList — 第七十二轮任务④ + 2026-09-26 命名纠正任务：「计分摊/不计分摊」筛选（判断依据改成 isOnlyMeSplit）', () => {
  it('切到「计分摊」：只剩 isOnlyMeSplit=false 的记录（真的分给了别人）', () => {
    vi.stubGlobal('fetch', mockFetch(vi.fn()));
    const expenses = [
      makeExpense({ id: 'A', merchant: 'A店', isOnlyMeSplit: false }),
      makeExpense({ id: 'B', merchant: 'B店', isOnlyMeSplit: true }),
    ];
    render(<ExpenseList tripId={TRIP_ID} expenses={expenses} myParticipantId={MY_ID} baseCurrency="MYR" />);
    fireEvent.click(screen.getByLabelText('按是否计分摊筛选'));
    fireEvent.mouseDown(screen.getByRole('option', { name: '计分摊' }));
    expect(screen.getByText('A店')).not.toBeNull();
    expect(screen.queryByText('B店')).toBeNull();
  });

  it('切到「不计分摊」：只剩 isOnlyMeSplit=true 的记录（只分给了付款人自己）', () => {
    vi.stubGlobal('fetch', mockFetch(vi.fn()));
    const expenses = [
      makeExpense({ id: 'A', merchant: 'A店', isOnlyMeSplit: false }),
      makeExpense({ id: 'B', merchant: 'B店', isOnlyMeSplit: true }),
    ];
    render(<ExpenseList tripId={TRIP_ID} expenses={expenses} myParticipantId={MY_ID} baseCurrency="MYR" />);
    fireEvent.click(screen.getByLabelText('按是否计分摊筛选'));
    fireEvent.mouseDown(screen.getByRole('option', { name: '不计分摊' }));
    expect(screen.getByText('B店')).not.toBeNull();
    expect(screen.queryByText('A店')).toBeNull();
  });

  it('这个筛选跟 excludeFromSplit 完全无关：excludeFromSplit=true 但 isOnlyMeSplit=false（业务成本但分给了同行人）时，切到「计分摊」仍然显示', () => {
    vi.stubGlobal('fetch', mockFetch(vi.fn()));
    const expenses = [makeExpense({ id: 'A', merchant: 'A店', excludeFromSplit: true, isOnlyMeSplit: false })];
    render(<ExpenseList tripId={TRIP_ID} expenses={expenses} myParticipantId={MY_ID} baseCurrency="MYR" />);
    fireEvent.click(screen.getByLabelText('按是否计分摊筛选'));
    fireEvent.mouseDown(screen.getByRole('option', { name: '计分摊' }));
    expect(screen.getByText('A店')).not.toBeNull();
  });

  it('这个筛选也会触发拖拽手柄消失（跟其它筛选一样被 hasActiveFilter 判定）', () => {
    vi.stubGlobal('fetch', mockFetch(vi.fn()));
    const expenses = [
      makeExpense({ id: 'A', merchant: 'A店', isOnlyMeSplit: false }),
      makeExpense({ id: 'B', merchant: 'B店', isOnlyMeSplit: true }),
    ];
    render(<ExpenseList tripId={TRIP_ID} expenses={expenses} myParticipantId={MY_ID} baseCurrency="MYR" />);
    fireEvent.click(screen.getByLabelText('按是否计分摊筛选'));
    fireEvent.mouseDown(screen.getByRole('option', { name: '计分摊' }));
    expect(screen.queryByLabelText('拖拽调整顺序')).toBeNull();
  });

  it('这个筛选真实交互后也会触发 PUT，body 里带上 splitFilter', async () => {
    const putSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(putSpy, null));
    const expenses = [makeExpense({ id: 'A', merchant: 'A店' })];
    render(<ExpenseList tripId={TRIP_ID} expenses={expenses} myParticipantId={MY_ID} baseCurrency="MYR" />);

    fireEvent.click(screen.getByLabelText('按是否计分摊筛选'));
    fireEvent.mouseDown(screen.getByRole('option', { name: '不计分摊' }));

    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    const body = JSON.parse(putSpy.mock.calls[0]![1]);
    expect(body.splitFilter).toBe('excluded');
  });
});

describe('ExpenseList — 2026-09-26 命名纠正任务新增：「业务成本」筛选（判断依据是 excludeFromSplit）', () => {
  it('行内小标签文案是"业务成本"，不再是"不计分摊"', () => {
    vi.stubGlobal('fetch', mockFetch(vi.fn()));
    const expenses = [makeExpense({ id: 'A', merchant: 'A店', excludeFromSplit: true })];
    render(<ExpenseList tripId={TRIP_ID} expenses={expenses} myParticipantId={MY_ID} baseCurrency="MYR" />);
    expect(screen.getByText('业务成本')).not.toBeNull();
    expect(screen.queryByText('不计分摊')).toBeNull();
  });

  it('切到「业务成本」：只剩 excludeFromSplit=true 的记录', () => {
    vi.stubGlobal('fetch', mockFetch(vi.fn()));
    const expenses = [
      makeExpense({ id: 'A', merchant: 'A店', excludeFromSplit: false }),
      makeExpense({ id: 'B', merchant: 'B店', excludeFromSplit: true }),
    ];
    render(<ExpenseList tripId={TRIP_ID} expenses={expenses} myParticipantId={MY_ID} baseCurrency="MYR" />);
    fireEvent.click(screen.getByLabelText('按是否业务成本筛选'));
    fireEvent.mouseDown(screen.getByRole('option', { name: '业务成本' }));
    expect(screen.getByText('B店')).not.toBeNull();
    expect(screen.queryByText('A店')).toBeNull();
  });

  it('切到「非业务成本」：只剩 excludeFromSplit=false 的记录', () => {
    vi.stubGlobal('fetch', mockFetch(vi.fn()));
    const expenses = [
      makeExpense({ id: 'A', merchant: 'A店', excludeFromSplit: false }),
      makeExpense({ id: 'B', merchant: 'B店', excludeFromSplit: true }),
    ];
    render(<ExpenseList tripId={TRIP_ID} expenses={expenses} myParticipantId={MY_ID} baseCurrency="MYR" />);
    fireEvent.click(screen.getByLabelText('按是否业务成本筛选'));
    fireEvent.mouseDown(screen.getByRole('option', { name: '非业务成本' }));
    expect(screen.getByText('A店')).not.toBeNull();
    expect(screen.queryByText('B店')).toBeNull();
  });

  it('这个筛选是跟「计分摊/不计分摊」完全独立的条件：excludeFromSplit=true 但 isOnlyMeSplit=false 时，切到「业务成本」仍然显示', () => {
    vi.stubGlobal('fetch', mockFetch(vi.fn()));
    const expenses = [makeExpense({ id: 'A', merchant: 'A店', excludeFromSplit: true, isOnlyMeSplit: false })];
    render(<ExpenseList tripId={TRIP_ID} expenses={expenses} myParticipantId={MY_ID} baseCurrency="MYR" />);
    fireEvent.click(screen.getByLabelText('按是否业务成本筛选'));
    fireEvent.mouseDown(screen.getByRole('option', { name: '业务成本' }));
    expect(screen.getByText('A店')).not.toBeNull();
  });

  it('这个筛选也会触发拖拽手柄消失（跟其它筛选一样被 hasActiveFilter 判定）', () => {
    vi.stubGlobal('fetch', mockFetch(vi.fn()));
    const expenses = [
      makeExpense({ id: 'A', merchant: 'A店', excludeFromSplit: false }),
      makeExpense({ id: 'B', merchant: 'B店', excludeFromSplit: true }),
    ];
    render(<ExpenseList tripId={TRIP_ID} expenses={expenses} myParticipantId={MY_ID} baseCurrency="MYR" />);
    fireEvent.click(screen.getByLabelText('按是否业务成本筛选'));
    fireEvent.mouseDown(screen.getByRole('option', { name: '业务成本' }));
    expect(screen.queryByLabelText('拖拽调整顺序')).toBeNull();
  });

  it('这个筛选真实交互后也会触发 PUT，body 里带上 businessCostFilter', async () => {
    const putSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(putSpy, null));
    const expenses = [makeExpense({ id: 'A', merchant: 'A店' })];
    render(<ExpenseList tripId={TRIP_ID} expenses={expenses} myParticipantId={MY_ID} baseCurrency="MYR" />);

    fireEvent.click(screen.getByLabelText('按是否业务成本筛选'));
    fireEvent.mouseDown(screen.getByRole('option', { name: '业务成本' }));

    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    const body = JSON.parse(putSpy.mock.calls[0]![1]);
    expect(body.businessCostFilter).toBe('yes');
  });
});

describe('ExpenseList — round72 第三批②：按当前筛选结果分币种小计（默认收起，点开展开明细）', () => {
  it('默认收起：只显示"N 笔 · 金额..."一行，不显示分币种明细行', () => {
    vi.stubGlobal('fetch', mockFetch(vi.fn()));
    const expenses = [
      makeExpense({ id: 'A', currency: 'HKD', amount: 10000, amountBaseCurrency: 10000 }),
      makeExpense({ id: 'B', currency: 'MYR', amount: 20000, amountBaseCurrency: 6000 }),
    ];
    render(<ExpenseList tripId={TRIP_ID} expenses={expenses} myParticipantId={MY_ID} baseCurrency="HKD" />);

    const trigger = screen.getByLabelText('按当前筛选分币种小计');
    expect(trigger.textContent).toContain('2 笔');
    expect(trigger.textContent).toContain('HK$100.00');
    expect(trigger.textContent).toContain('RM');
    expect(trigger.textContent).toContain('200.00');
    expect(trigger.textContent).toContain('HK$160.00');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    // 明细行（币种代码单独一行）这时候不应该出现——collapsed 状态下不渲染展开区块。
    expect(screen.queryByText('MYR')).toBeNull();
  });

  it('点开展开：显示分币种明细行 + "≈{本位币}合计"行，本位币读的是真实 baseCurrency prop（不是写死的字面量占位符）', () => {
    vi.stubGlobal('fetch', mockFetch(vi.fn()));
    const expenses = [
      makeExpense({ id: 'A', currency: 'HKD', amount: 10000, amountBaseCurrency: 10000 }),
      makeExpense({ id: 'B', currency: 'MYR', amount: 20000, amountBaseCurrency: 6000 }),
    ];
    render(<ExpenseList tripId={TRIP_ID} expenses={expenses} myParticipantId={MY_ID} baseCurrency="HKD" />);

    fireEvent.click(screen.getByLabelText('按当前筛选分币种小计'));
    expect(screen.getByLabelText('按当前筛选分币种小计').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('HKD')).not.toBeNull();
    expect(screen.getByText('MYR')).not.toBeNull();
    expect(screen.getByText('≈HKD 合计')).not.toBeNull();
    expect(screen.queryByText('≈MYR 合计')).toBeNull();
  });

  it('换一趟本位币不同的行程（同样的多币种数据），"≈合计"这一行的币种代码跟着变——证明不是写死的固定字符串', () => {
    vi.stubGlobal('fetch', mockFetch(vi.fn()));
    const expenses = [
      makeExpense({ id: 'A', currency: 'HKD', amount: 10000, amountBaseCurrency: 3000 }),
      makeExpense({ id: 'B', currency: 'MYR', amount: 20000, amountBaseCurrency: 6000 }),
    ];
    render(<ExpenseList tripId={TRIP_ID} expenses={expenses} myParticipantId={MY_ID} baseCurrency="USD" />);
    fireEvent.click(screen.getByLabelText('按当前筛选分币种小计'));
    expect(screen.getByText('≈USD 合计')).not.toBeNull();
    expect(screen.queryByText('≈HKD 合计')).toBeNull();
    expect(screen.queryByText('≈MYR 合计')).toBeNull();
  });

  it('只有一种币种、且正好是本位币时，不显示多余的"≈合计"行（跟上面那笔金额完全重复）', () => {
    vi.stubGlobal('fetch', mockFetch(vi.fn()));
    const expenses = [makeExpense({ id: 'A', currency: 'HKD', amount: 10000, amountBaseCurrency: 10000 })];
    render(<ExpenseList tripId={TRIP_ID} expenses={expenses} myParticipantId={MY_ID} baseCurrency="HKD" />);
    const trigger = screen.getByLabelText('按当前筛选分币种小计');
    expect(trigger.textContent).toContain('1 笔');
    expect(trigger.textContent).toContain('HK$100.00');
    expect(trigger.textContent).not.toContain('≈');
    fireEvent.click(trigger);
    expect(screen.queryByText('≈HKD 合计')).toBeNull();
  });

  it('只有一种币种、但不是本位币时，仍显示"≈合计"（提供换算参考，不是"多币种才显示"的误判）', () => {
    vi.stubGlobal('fetch', mockFetch(vi.fn()));
    const expenses = [makeExpense({ id: 'A', currency: 'MYR', amount: 20000, amountBaseCurrency: 6000 })];
    render(<ExpenseList tripId={TRIP_ID} expenses={expenses} myParticipantId={MY_ID} baseCurrency="HKD" />);
    const trigger = screen.getByLabelText('按当前筛选分币种小计');
    expect(trigger.textContent).toContain('RM');
    expect(trigger.textContent).toContain('200.00');
    expect(trigger.textContent).toContain('≈');
    expect(trigger.textContent).toContain('HK$60.00');
  });

  it('小计会跟着当前筛选结果收窄——切筛选后笔数和金额都跟着变，不是对全部消费算的固定值', () => {
    vi.stubGlobal('fetch', mockFetch(vi.fn()));
    const expenses = [
      makeExpense({ id: 'A', merchant: 'A店', category: '🍜 餐饮', currency: 'HKD', amount: 10000, amountBaseCurrency: 10000 }),
      makeExpense({ id: 'B', merchant: 'B店', category: '🚕 交通', currency: 'HKD', amount: 5000, amountBaseCurrency: 5000 }),
    ];
    render(<ExpenseList tripId={TRIP_ID} expenses={expenses} myParticipantId={MY_ID} baseCurrency="HKD" />);
    expect(screen.getByLabelText('按当前筛选分币种小计').textContent).toContain('2 笔');

    fireEvent.click(screen.getByLabelText('按分类筛选'));
    fireEvent.mouseDown(screen.getByRole('option', { name: '🍜 餐饮' }));

    const trigger = screen.getByLabelText('按当前筛选分币种小计');
    expect(trigger.textContent).toContain('1 笔');
    expect(trigger.textContent).toContain('HK$100.00');
    expect(trigger.textContent).not.toContain('HK$50.00');
  });

  it('筛选后 0 笔（还有其它消费，只是这条筛选谁都不符合）时不渲染小计区块——空状态文案已经说清楚了，不重复一条"0 笔"', () => {
    vi.stubGlobal('fetch', mockFetch(vi.fn()));
    const expenses = [
      makeExpense({ id: 'A', merchant: 'A店', currency: 'HKD', isOnlyMeSplit: false }),
    ];
    render(<ExpenseList tripId={TRIP_ID} expenses={expenses} myParticipantId={MY_ID} baseCurrency="HKD" />);
    // 「计分摊/不计分摊」筛选选项是固定的三选一（全部/计分摊/不计分摊），不依赖
    // 数据里实际出现过哪些值——这条消费 isOnlyMeSplit=false，切到「不计分摊」
    // （要求 isOnlyMeSplit=true）谁都不符合，正好用来测"筛选后 0 笔"这个场景。
    fireEvent.click(screen.getByLabelText('按是否计分摊筛选'));
    fireEvent.mouseDown(screen.getByRole('option', { name: '不计分摊' }));
    expect(screen.queryByLabelText('按当前筛选分币种小计')).toBeNull();
    expect(screen.getByText('没有符合筛选条件的消费。')).not.toBeNull();
  });
});
