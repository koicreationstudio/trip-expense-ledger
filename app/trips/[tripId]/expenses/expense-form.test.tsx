// @vitest-environment jsdom
/**
 * 第六十八轮任务 J：记账表单三处金额输入框（主金额 + 自定义分摊逐人金额）加千分位。
 *
 * 只锁这几件最容易出真实数据损坏的事——不是把整个表单的所有交互都测一遍：
 * ①展示带千分位，但提交给后端的 payload（分为单位的整数）完全正确，尤其带小数
 * 带逗号的输入 ②粘贴带逗号的数字不会变成 NaN ③编辑已有消费时旧金额正确带千分位
 * 回填 ④"2 人自动算另一人分摊余数"这段既有联动在套了千分位之后还算对（不能拿
 * 带逗号的展示字符串去做减法）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// ExpenseForm 调用 `useRouter()`（`router.push`/`router.refresh`），这个组件测试
// 不跑在真实 Next.js App Router 树里，需要手动 mock 掉——跟 fx-compare-card.tsx
// 不用 router 的情况不一样，那边不需要这段。
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { ExpenseForm, type InitialExpense } from './expense-form';

function callArg(spy: ReturnType<typeof vi.fn>, callIndex = 0): any {
  const call = spy.mock.calls[callIndex];
  if (!call) throw new Error(`spy 没有被调用第 ${callIndex + 1} 次`);
  return call[0];
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TRIP_ID = 'trip-round68-test';
const PARTICIPANTS = [
  { id: 'p1', displayName: '我' },
  { id: 'p2', displayName: '小明' },
];
// fix(2026-09-26 第七十一轮，任务⑦)：代垫人是自己时必须选支付方式，round68 这几条
// 千分位测试原本用 paymentMethods={[]}（当时这条强制规则还不存在），现在会被
// paymentMethodMissing 挡住提交——补一个最小可用的支付方式 fixture + 选择 helper，
// 不改这几条测试本来要验证的千分位逻辑本身。
const PAYMENT_METHODS = [{ id: 'pm1', label: '现金' }];

function selectPaymentMethod(label: string) {
  fireEvent.click(screen.getByLabelText('支付方式'));
  fireEvent.mouseDown(screen.getByRole('option', { name: label }));
}

function mockFetch(postSpy: (body: any) => void) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.includes('/expenses') && (method === 'POST' || method === 'PATCH')) {
      const body = JSON.parse(String(init?.body ?? '{}'));
      postSpy(body);
      return new Response(JSON.stringify({ expense: { id: 'exp-1' } }), { status: 200 });
    }
    throw new Error(`未预期的请求：${method} ${url}`);
  });
}

describe('ExpenseForm — 第六十八轮任务 J：主金额输入框千分位', () => {
  it('打字输入格式化成千分位展示，提交后 POST body 的 amount 是正确的分整数', async () => {
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(postSpy));

    render(
      <ExpenseForm
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
    selectPaymentMethod('现金');

    fireEvent.click(screen.getByRole('button', { name: '记这笔账' }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const body = callArg(postSpy);
    // 12500.5 元 = 1250050 分，不能因为千分位/小数处理错误变成 12、NaN 或截断。
    expect(body.amount).toBe(1250050);
  });

  it('粘贴带逗号的数字（"12,500"）被正确剥离，不产生 NaN，提交金额正确', async () => {
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(postSpy));

    render(
      <ExpenseForm
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
    selectPaymentMethod('现金');

    fireEvent.click(screen.getByRole('button', { name: '记这笔账' }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const body = callArg(postSpy);
    expect(body.amount).toBe(1250000);
    expect(Number.isNaN(body.amount)).toBe(false);
  });

  it('编辑已有消费：旧金额（1250050 分）回填展示成 "12,500.5"，不是裸数字', () => {
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(postSpy));

    const initialExpense: InitialExpense = {
      id: 'exp-existing',
      amount: 1250050,
      currency: 'MYR',
      payerParticipantId: 'p1',
      category: '🍜 餐饮',
      merchant: null,
      note: null,
      expenseDate: '2026-09-01T00:00:00.000Z',
      fxRateUsed: 1,
      amountBaseCurrency: 1250050,
      hasReceipt: false,
      splits: [{ participantId: 'p1', shareAmountBaseCurrency: 1250050 }],
      paymentMethodId: null,
      excludeFromSplit: false,
    };

    render(
      <ExpenseForm
        tripId={TRIP_ID}
        baseCurrency="MYR"
        myParticipantId="p1"
        participants={PARTICIPANTS}
        paymentMethods={[]}
        initialExpense={initialExpense}
      />
    );

    const amountInput = screen.getByLabelText('金额') as HTMLInputElement;
    expect(amountInput.value).toBe('12,500.5');
  });

  it('非法字符（字母）被静默拒绝，展示值不变', () => {
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(postSpy));

    render(
      <ExpenseForm
        tripId={TRIP_ID}
        baseCurrency="MYR"
        myParticipantId="p1"
        participants={PARTICIPANTS}
        paymentMethods={[]}
      />
    );

    const amountInput = screen.getByLabelText('金额') as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: '1,000', selectionStart: 5 } });
    expect(amountInput.value).toBe('1,000');
    fireEvent.change(amountInput, { target: { value: '1,000a', selectionStart: 6 } });
    expect(amountInput.value).toBe('1,000');
  });
});

describe('ExpenseForm — 第六十八轮任务 J：自定义分摊逐人金额输入框千分位 + 2 人余数联动', () => {
  it('2 人自定义分摊：改一个人的金额（带千分位展示）之后，另一个人自动补成正确的剩余金额', async () => {
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(postSpy));

    render(
      <ExpenseForm
        tripId={TRIP_ID}
        baseCurrency="MYR"
        myParticipantId="p1"
        participants={PARTICIPANTS}
        paymentMethods={PAYMENT_METHODS}
      />
    );

    // 先填总金额 12000，再打开"跟其他人 split 这笔"开关 + 切到"自定义分摊"。
    fireEvent.change(screen.getByLabelText('金额'), { target: { value: '12000', selectionStart: 5 } });
    fireEvent.click(screen.getByRole('switch', { name: '跟其他人 split 这笔' }));
    fireEvent.click(screen.getByRole('button', { name: '自定义分摊' }));
    selectPaymentMethod('现金');

    // 这个表单没有给每个参与者的分摊输入框加各自的 aria-label，退回用
    // DOM 结构定位：用 querySelector 直接拿两个分摊 input（field-input 系列，
    // w-[58px] 那个），顺序跟 `includedParticipants` 渲染顺序一致（p1 我、p2 小明）。
    const splitInputs = Array.from(document.querySelectorAll('input.field-input.w-\\[58px\\]')) as HTMLInputElement[];
    expect(splitInputs.length).toBe(2);
    const firstInput = splitInputs[0];
    const secondInput = splitInputs[1];
    if (!firstInput || !secondInput) throw new Error('分摊输入框没有找齐 2 个');

    fireEvent.change(firstInput, { target: { value: '5,000', selectionStart: 5 } });
    expect(firstInput.value).toBe('5,000');
    // 12000 - 5000 = 7000，展示应该带千分位 "7,000"，不是 "7000" 也不是算错的数字。
    expect(secondInput.value).toBe('7,000');

    fireEvent.click(screen.getByRole('button', { name: '记这笔账' }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const body = callArg(postSpy);
    expect(body.amount).toBe(1200000); // 12000 元
    const totalSplit = body.splits.reduce((sum: number, s: any) => sum + s.shareAmountBaseCurrency, 0);
    expect(totalSplit).toBe(1200000);
  });
});

// fix(2026-09-26 第七十一轮，任务①)：汇率自动带入 + 当地金额并排展示。
describe('ExpenseForm — 第七十一轮任务①：汇率自动带入 + 当地金额展示', () => {
  function mockFetchWithFxRates(rates: Record<string, number>) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.includes('/fx-mid-rates')) {
        return new Response(JSON.stringify({ base: 'MYR', rates, fetchedAt: null, stale: false }), { status: 200 });
      }
      if (url.includes('/expenses') && (method === 'POST' || method === 'PATCH')) {
        return new Response(JSON.stringify({ expense: { id: 'exp-1' } }), { status: 200 });
      }
      throw new Error(`未预期的请求：${method} ${url}`);
    });
  }

  it('币种切到非本位币后，自动拉汇率并填进汇率框，旁边"当地金额"跟着算出来', async () => {
    // rates 是"1 MYR = X <currency>"这张表，deriveMidRate 用它换算 THB→MYR。
    vi.stubGlobal('fetch', mockFetchWithFxRates({ MYR: 1, THB: 7.5 }));

    render(
      <ExpenseForm
        tripId={TRIP_ID}
        baseCurrency="MYR"
        myParticipantId="p1"
        participants={PARTICIPANTS}
        paymentMethods={PAYMENT_METHODS}
      />
    );

    fireEvent.change(screen.getByLabelText('金额'), { target: { value: '750', selectionStart: 3 } });
    fireEvent.click(screen.getByLabelText('币种'));
    fireEvent.mouseDown(screen.getByRole('option', { name: 'THB' }));

    // 1 THB = 1/7.5 MYR ≈ 0.1333 MYR，自动带入后汇率框应该不再是空的。
    await waitFor(() => {
      const rateInput = screen.getByLabelText(/汇率/) as HTMLInputElement;
      expect(rateInput.value).not.toBe('');
    });
    const rateInput = screen.getByLabelText(/汇率/) as HTMLInputElement;
    expect(Number(rateInput.value)).toBeCloseTo(1 / 7.5, 4);

    // 当地金额 = 750 × (1/7.5) ≈ 100 MYR。div 不是 labelable element，
    // getByLabelText 关联不上，直接用 id 查。
    const localAmount = document.getElementById('local-amount');
    expect(localAmount?.textContent).toMatch(/100/);
  });

  it('用户手动改过汇率框之后，不会被自动带入的值覆盖回去', async () => {
    vi.stubGlobal('fetch', mockFetchWithFxRates({ MYR: 1, THB: 7.5 }));

    render(
      <ExpenseForm
        tripId={TRIP_ID}
        baseCurrency="MYR"
        myParticipantId="p1"
        participants={PARTICIPANTS}
        paymentMethods={PAYMENT_METHODS}
      />
    );

    fireEvent.click(screen.getByLabelText('币种'));
    fireEvent.mouseDown(screen.getByRole('option', { name: 'THB' }));

    await waitFor(() => {
      const rateInput = screen.getByLabelText(/汇率/) as HTMLInputElement;
      expect(rateInput.value).not.toBe('');
    });

    const rateInput = screen.getByLabelText(/汇率/) as HTMLInputElement;
    fireEvent.change(rateInput, { target: { value: '0.5' } });
    expect(rateInput.value).toBe('0.5');

    // 等一轮 microtask，确认没有被自动带入逻辑（依赖数组里 liveMidRates 没变化，
    // 不会重新触发，但这里显式等一下确保真的没有异步覆盖回去）。
    await new Promise((r) => setTimeout(r, 0));
    expect((screen.getByLabelText(/汇率/) as HTMLInputElement).value).toBe('0.5');
  });
});

describe('ExpenseForm — 第七十一轮任务⑦：代垫人是自己时必须选支付方式', () => {
  it('这趟行程没有启用任何支付方式时，显示引导去设置页，不强制卡死在选不出来的下拉上', () => {
    vi.stubGlobal('fetch', mockFetch(vi.fn()));
    render(
      <ExpenseForm
        tripId={TRIP_ID}
        baseCurrency="MYR"
        myParticipantId="p1"
        participants={PARTICIPANTS}
        paymentMethods={[]}
      />
    );
    const link = screen.getByRole('link', { name: '支付方式设置' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(`/trips/${TRIP_ID}/payment-methods`);
  });

  it('PM 复核补充：零支付方式可选时不能卡死——提交按钮必须是可点的，POST 能正常发出（不带 paymentMethodId）', async () => {
    // 这条锁的是一个真 bug：round71 checkpoint 版本的 paymentMethodMissing 没有
    // 豁免"paymentMethods.length===0"这个情况，导致这趟行程没配支付方式时提交
    // 按钮永久禁用，用户完全没法记账。后端 POST 早就用
    // `loadEnabledPaymentMethodIds` 非空才强制这条规则，前端要跟上同一条豁免。
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(postSpy));
    render(
      <ExpenseForm
        tripId={TRIP_ID}
        baseCurrency="MYR"
        myParticipantId="p1"
        participants={PARTICIPANTS}
        paymentMethods={[]}
      />
    );
    fireEvent.change(screen.getByLabelText('金额'), { target: { value: '100', selectionStart: 3 } });
    const submitButton = screen.getByRole('button', { name: '记这笔账' }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(false);

    fireEvent.click(submitButton);
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(callArg(postSpy).paymentMethodId).toBeUndefined();
  });

  it('代垫人是自己、有支付方式可选但没选：提交按钮禁用 + 提交被拦下不发请求', async () => {
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(postSpy));
    render(
      <ExpenseForm
        tripId={TRIP_ID}
        baseCurrency="MYR"
        myParticipantId="p1"
        participants={PARTICIPANTS}
        paymentMethods={PAYMENT_METHODS}
      />
    );
    fireEvent.change(screen.getByLabelText('金额'), { target: { value: '100', selectionStart: 3 } });
    const submitButton = screen.getByRole('button', { name: '记这笔账' }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
    // 按钮已经 disabled，浏览器/jsdom 里点击 disabled 按钮本来就不会触发 onSubmit——
    // 这里验证的正是"根本点不动"这一层防御，不是走到提交后被拦截那一层。
    fireEvent.click(submitButton);
    await new Promise((r) => setTimeout(r, 0));
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('代垫人是别人代垫时，不强制选支付方式，提交按钮不因此被禁用', () => {
    render(
      <ExpenseForm
        tripId={TRIP_ID}
        baseCurrency="MYR"
        myParticipantId="p1"
        participants={PARTICIPANTS}
        paymentMethods={PAYMENT_METHODS}
      />
    );
    fireEvent.change(screen.getByLabelText('金额'), { target: { value: '100', selectionStart: 3 } });
    fireEvent.click(screen.getByRole('switch', { name: '跟其他人 split 这笔' }));
    fireEvent.click(screen.getByLabelText('谁垫的钱？'));
    fireEvent.mouseDown(screen.getByRole('option', { name: '小明' }));
    const submitButton = screen.getByRole('button', { name: '记这笔账' }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(false);
  });
});
