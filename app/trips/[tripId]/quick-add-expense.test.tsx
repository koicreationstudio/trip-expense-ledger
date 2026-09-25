// @vitest-environment jsdom
/**
 * 第六十八轮任务 J：快速记账两处金额输入框（主金额 + 自定义分摊逐人金额）加千分位。
 *
 * 特别要锁住的一条：`resetForm()` 提交成功后会把 `amountYuan` 设回 `''`——这不是
 * "用户打字"触发的，套了千分位之后这条清空路径不能报错、也不能显示成 "0" 或
 * 遗留上一笔的金额。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { QuickAddExpense } from './quick-add-expense';

function callArg(spy: ReturnType<typeof vi.fn>, callIndex = 0): any {
  const call = spy.mock.calls[callIndex];
  if (!call) throw new Error(`spy 没有被调用第 ${callIndex + 1} 次`);
  return call[0];
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TRIP_ID = 'trip-round68-quickadd-test';
const PARTICIPANTS = [
  { id: 'p1', displayName: '我' },
  { id: 'p2', displayName: '小明' },
];
// fix(第七十一轮，任务⑦)：这个组件代垫人恒等于自己，支付方式现在永远必填——
// 已有的千分位测试如果不选支付方式，提交按钮会保持禁用，postSpy 永远不会被调用、
// 测试会超时失败，所以下面每条已有测试都要补一步"选支付方式"。
const PAYMENT_METHODS = [{ id: 'pm1', label: '现金 MYR' }];

async function selectPaymentMethod() {
  // SelectDropdown 的选项是 onMouseDown（不是 onClick）触发 onChange，跟
  // expense-form.test.tsx 里"选币种"用的是同一个组件、同一套事件。
  fireEvent.click(screen.getByLabelText('支付方式'));
  fireEvent.mouseDown(await screen.findByRole('option', { name: '现金 MYR' }));
}

function mockFetch(postSpy: (body: any) => void, ok = true) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.includes('/expenses') && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      postSpy(body);
      return ok
        ? new Response(JSON.stringify({ expense: { id: 'exp-1' } }), { status: 200 })
        : new Response(JSON.stringify({ error: 'invalid_payer' }), { status: 400 });
    }
    throw new Error(`未预期的请求：${method} ${url}`);
  });
}

describe('QuickAddExpense — 第六十八轮任务 J：主金额输入框千分位', () => {
  it('打字输入格式化成千分位展示，提交后 POST body 的 amount 是正确的分整数', async () => {
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(postSpy));

    render(
      <QuickAddExpense
        tripId={TRIP_ID}
        baseCurrency="MYR"
        myParticipantId="p1"
        participants={PARTICIPANTS}
        paymentMethods={PAYMENT_METHODS}
      />
    );

    const amountInput = screen.getByLabelText('金额') as HTMLInputElement;
    expect(amountInput.type).toBe('text');
    fireEvent.change(amountInput, { target: { value: '12500.5', selectionStart: 7 } });
    expect(amountInput.value).toBe('12,500.5');

    fireEvent.change(screen.getByLabelText('分类'), { target: { value: '🍜 餐饮' } });

    await selectPaymentMethod();
    fireEvent.click(screen.getByRole('button', { name: '记' }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(callArg(postSpy).amount).toBe(1250050);
  });

  it('粘贴带逗号的数字不会产生 NaN，提交金额正确', async () => {
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(postSpy));

    render(
      <QuickAddExpense
        tripId={TRIP_ID}
        baseCurrency="MYR"
        myParticipantId="p1"
        participants={PARTICIPANTS}
        paymentMethods={PAYMENT_METHODS}
      />
    );

    const amountInput = screen.getByLabelText('金额') as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: '12,500', selectionStart: 6 } });
    expect(amountInput.value).toBe('12,500');
    fireEvent.change(screen.getByLabelText('分类'), { target: { value: '🍜 餐饮' } });

    await selectPaymentMethod();
    fireEvent.click(screen.getByRole('button', { name: '记' }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const body = callArg(postSpy);
    expect(body.amount).toBe(1250000);
    expect(Number.isNaN(body.amount)).toBe(false);
  });

  it('提交成功后 resetForm() 清空金额，input 显示空字符串（不是 "0"、不报错、不残留上一笔金额）', async () => {
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(postSpy));

    render(
      <QuickAddExpense
        tripId={TRIP_ID}
        baseCurrency="MYR"
        myParticipantId="p1"
        participants={PARTICIPANTS}
        paymentMethods={PAYMENT_METHODS}
      />
    );

    const amountInput = screen.getByLabelText('金额') as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: '8888', selectionStart: 4 } });
    expect(amountInput.value).toBe('8,888');
    fireEvent.change(screen.getByLabelText('分类'), { target: { value: '🍜 餐饮' } });

    await selectPaymentMethod();
    fireEvent.click(screen.getByRole('button', { name: '记' }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(amountInput.value).toBe(''));
  });
});

describe('QuickAddExpense — 第六十八轮任务 J：自定义分摊逐人金额输入框千分位', () => {
  it('自定义分摊：逐人金额输入框展示带千分位，禁用态（未勾选）的 input 不受影响', async () => {
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(postSpy));

    render(
      <QuickAddExpense
        tripId={TRIP_ID}
        baseCurrency="MYR"
        myParticipantId="p1"
        participants={PARTICIPANTS}
        paymentMethods={PAYMENT_METHODS}
      />
    );

    fireEvent.change(screen.getByLabelText('金额'), { target: { value: '15000', selectionStart: 5 } });
    fireEvent.change(screen.getByLabelText('分类'), { target: { value: '🍜 餐饮' } });
    fireEvent.click(screen.getByRole('button', { name: '自定义分摊' }));

    const myShareInput = screen.getByLabelText('我 分摊金额') as HTMLInputElement;
    fireEvent.change(myShareInput, { target: { value: '9000', selectionStart: 4 } });
    expect(myShareInput.value).toBe('9,000');

    const otherShareInput = screen.getByLabelText('小明 分摊金额') as HTMLInputElement;
    fireEvent.change(otherShareInput, { target: { value: '6,000', selectionStart: 5 } });
    expect(otherShareInput.value).toBe('6,000');

    await selectPaymentMethod();
    fireEvent.click(screen.getByRole('button', { name: '记' }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const body = callArg(postSpy);
    expect(body.amount).toBe(1500000);
    const totalSplit = body.splits.reduce((sum: number, s: any) => sum + s.shareAmountBaseCurrency, 0);
    expect(totalSplit).toBe(1500000);
  });
});

describe('QuickAddExpense — 第七十一轮任务⑦：支付方式必填', () => {
  it('没选支付方式时提交按钮保持禁用，不会发出 POST', async () => {
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(postSpy));

    render(
      <QuickAddExpense
        tripId={TRIP_ID}
        baseCurrency="MYR"
        myParticipantId="p1"
        participants={PARTICIPANTS}
        paymentMethods={PAYMENT_METHODS}
      />
    );

    fireEvent.change(screen.getByLabelText('金额'), { target: { value: '100', selectionStart: 3 } });
    fireEvent.change(screen.getByLabelText('分类'), { target: { value: '🍜 餐饮' } });

    const submitButton = screen.getByRole('button', { name: '记' }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
    fireEvent.click(submitButton);
    // disabled 按钮点击不会触发 onSubmit，给一个短暂等待确认 postSpy 真的没被调用
    // （不是"还没来得及调用"，是这条交互路径根本走不到）。
    await new Promise((r) => setTimeout(r, 50));
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('选了支付方式后按钮才可用，POST body 带上正确的 paymentMethodId', async () => {
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(postSpy));

    render(
      <QuickAddExpense
        tripId={TRIP_ID}
        baseCurrency="MYR"
        myParticipantId="p1"
        participants={PARTICIPANTS}
        paymentMethods={PAYMENT_METHODS}
      />
    );

    fireEvent.change(screen.getByLabelText('金额'), { target: { value: '100', selectionStart: 3 } });
    fireEvent.change(screen.getByLabelText('分类'), { target: { value: '🍜 餐饮' } });
    await selectPaymentMethod();

    const submitButton = screen.getByRole('button', { name: '记' }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(false);
    fireEvent.click(submitButton);
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(callArg(postSpy).paymentMethodId).toBe('pm1');
  });

  it('没有配置任何支付方式（paymentMethods=[]）时显示去设置页的引导文案，不是空白/卡死', () => {
    render(
      <QuickAddExpense
        tripId={TRIP_ID}
        baseCurrency="MYR"
        myParticipantId="p1"
        participants={PARTICIPANTS}
        paymentMethods={[]}
      />
    );

    expect(screen.getByText(/还没设置支付方式/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '支付方式设置' }).getAttribute('href')).toBe(
      `/trips/${TRIP_ID}/payment-methods`
    );
    // fix(2026-09-26 第七十一轮，PM 复核时改正)：这里原本断言 disabled===true——
    // 那是个真 bug，零支付方式可选时把提交按钮永久锁死，用户完全没法记账（后端
    // POST 早就用 `loadEnabledPaymentMethodIds` 非空才强制这条规则，前端没跟上
    // 同一条豁免）。改成断言按钮可点，跟后端行为一致。
    expect((screen.getByRole('button', { name: '记' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('PM 复核补充：零支付方式可选时提交能正常发出（不带 paymentMethodId），不是永久卡死', async () => {
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(postSpy));
    render(
      <QuickAddExpense
        tripId={TRIP_ID}
        baseCurrency="MYR"
        myParticipantId="p1"
        participants={PARTICIPANTS}
        paymentMethods={[]}
      />
    );
    fireEvent.change(screen.getByLabelText('金额'), { target: { value: '50', selectionStart: 2 } });
    fireEvent.change(screen.getByLabelText('分类'), { target: { value: '🍜 餐饮' } });
    fireEvent.click(screen.getByRole('button', { name: '记' }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(callArg(postSpy).paymentMethodId).toBeUndefined();
  });
});
