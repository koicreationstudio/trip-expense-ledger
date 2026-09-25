// @vitest-environment jsdom
/**
 * 第六十八轮任务 J：支付方式页两处金额输入框（新增支付方式"固定费" + 钱包"设置
 * 当前余额"）加千分位。三个百分比字段（汇率加点/境外手续费/返现）故意不在范围内。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PaymentMethodsManager } from './payment-methods-manager';

function callArg(spy: ReturnType<typeof vi.fn>, callIndex = 0): any {
  const call = spy.mock.calls[callIndex];
  if (!call) throw new Error(`spy 没有被调用第 ${callIndex + 1} 次`);
  return call[0];
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TRIP_ID = 'trip-round68-pm-test';

const WALLET = {
  id: 'w1',
  label: '现金钱包',
  currency: 'MYR',
  emoji: '💰',
  currentBalance: 500000, // 5000.00 元
  balanceUpdatedAt: null,
  paymentMethodId: null,
};

function mockFetch(opts: { postSpy?: (body: any) => void; patchSpy?: (body: any) => void }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.endsWith('/payment-methods') && method === 'GET') {
      return new Response(JSON.stringify({ paymentMethods: [] }), { status: 200 });
    }
    if (url.endsWith('/wallets') && method === 'GET') {
      return new Response(JSON.stringify({ wallets: [WALLET] }), { status: 200 });
    }
    if (url === '/api/payment-methods' && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      opts.postSpy?.(body);
      return new Response(JSON.stringify({ paymentMethod: { id: 'pm-1' } }), { status: 200 });
    }
    if (url.includes(`/wallets/${WALLET.id}`) && method === 'PATCH') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      opts.patchSpy?.(body);
      return new Response(JSON.stringify({ wallet: { ...WALLET, currentBalance: body.currentBalance } }), {
        status: 200,
      });
    }
    throw new Error(`未预期的请求：${method} ${url}`);
  });
}

describe('PaymentMethodsManager — 第六十八轮任务 J：固定费输入框千分位', () => {
  it('固定费展示带千分位，提交后 fixedFee（分）正确', async () => {
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch({ postSpy }));

    render(<PaymentMethodsManager tripId={TRIP_ID} />);
    await waitFor(() => expect(screen.getByText('还没配置任何支付方式。')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '测试卡' } });
    const fixedFeeInput = screen.getByLabelText('固定费（结算币种，元）') as HTMLInputElement;
    expect(fixedFeeInput.type).toBe('text');
    fireEvent.change(fixedFeeInput, { target: { value: '1250.5', selectionStart: 7 } });
    expect(fixedFeeInput.value).toBe('1,250.5');

    fireEvent.click(screen.getByRole('button', { name: '添加支付方式' }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(callArg(postSpy).fixedFee).toBe(125050);
  });

  it('粘贴带逗号数字不产生 NaN', async () => {
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch({ postSpy }));

    render(<PaymentMethodsManager tripId={TRIP_ID} />);
    await waitFor(() => expect(screen.getByText('还没配置任何支付方式。')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '测试卡2' } });
    const fixedFeeInput = screen.getByLabelText('固定费（结算币种，元）') as HTMLInputElement;
    fireEvent.change(fixedFeeInput, { target: { value: '1,500', selectionStart: 5 } });
    expect(fixedFeeInput.value).toBe('1,500');

    fireEvent.click(screen.getByRole('button', { name: '添加支付方式' }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(callArg(postSpy).fixedFee).toBe(150000);
    expect(Number.isNaN(callArg(postSpy).fixedFee)).toBe(false);
  });
});

describe('PaymentMethodsManager — 第六十八轮任务 J：钱包"设置当前余额"输入框千分位', () => {
  it('编辑回填：已有余额（500000 分）展示成 "5,000"，不是裸数字', async () => {
    vi.stubGlobal('fetch', mockFetch({}));

    // 不传 `defaultOpenBalancePanel`——那条路径会触发一个只在真实浏览器里才有的
    // `scrollIntoView` 调用，jsdom 没实现这个 API 会直接抛错。手动点开"⚙设置当前
    // 余额"折叠面板，效果跟 `defaultOpenBalancePanel` 打开面板这一步是一样的，
    // 只是不触发那段滚动副作用，不影响这条测试要验证的千分位这件事。
    render(<PaymentMethodsManager tripId={TRIP_ID} />);
    await waitFor(() => expect(screen.getByText('还没配置任何支付方式。')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '⚙ 设置当前余额' }));
    await waitFor(() => expect(screen.getByText('现金钱包')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    const balanceInput = screen.getByLabelText('当前余额（MYR）') as HTMLInputElement;
    expect(balanceInput.type).toBe('text');
    expect(balanceInput.value).toBe('5,000');
  });

  it('改成新余额（带千分位/小数），保存后 PATCH body 的 currentBalance（分）正确', async () => {
    const patchSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch({ patchSpy }));

    render(<PaymentMethodsManager tripId={TRIP_ID} />);
    await waitFor(() => expect(screen.getByText('还没配置任何支付方式。')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '⚙ 设置当前余额' }));
    await waitFor(() => expect(screen.getByText('现金钱包')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '设置' }));

    const balanceInput = screen.getByLabelText('当前余额（MYR）') as HTMLInputElement;
    fireEvent.change(balanceInput, { target: { value: '12500.75', selectionStart: 8 } });
    expect(balanceInput.value).toBe('12,500.75');

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(callArg(patchSpy).currentBalance).toBe(1250075);
  });
});
