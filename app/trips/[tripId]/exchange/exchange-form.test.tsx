// @vitest-environment jsdom
/**
 * 第六十八轮任务 J：换汇记录表单四处金额输入框（拿出多少/换到.../存多少(第二个
 * 钱包)/存款手续费）加千分位。「本次汇率」故意不在范围内（判断依据见
 * exchange-form.tsx `useThousandsField` 调用处的注释）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { ExchangeForm, type WalletOption } from './exchange-form';

function callArg(spy: ReturnType<typeof vi.fn>, callIndex = 0): any {
  const call = spy.mock.calls[callIndex];
  if (!call) throw new Error(`spy 没有被调用第 ${callIndex + 1} 次`);
  return call[0];
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TRIP_ID = 'trip-round68-exchange-test';
const WALLETS: WalletOption[] = [
  { id: 'w1', label: '美金现金', currency: 'USD', emoji: '💵' },
  { id: 'w2', label: '泰铢现金', currency: 'THB', emoji: '💵' },
  { id: 'w3', label: '现金钱包', currency: 'MYR', emoji: '💰' },
];

function mockFetch(postSpy: (body: any) => void) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.includes('/exchange-records') && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      postSpy(body);
      return new Response(JSON.stringify({ exchangeRecord: { id: 'ex-1' } }), { status: 200 });
    }
    throw new Error(`未预期的请求：${method} ${url}`);
  });
}

describe('ExchangeForm — 第六十八轮任务 J：金额输入框千分位', () => {
  it('"换到...存多少"输入框格式化成千分位，提交后 toAmount（分）正确', async () => {
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(postSpy));

    render(<ExchangeForm tripId={TRIP_ID} wallets={WALLETS} />);

    const toAmountInput = screen.getByLabelText(/换到.*存多少/) as HTMLInputElement;
    expect(toAmountInput.type).toBe('text');
    fireEvent.change(toAmountInput, { target: { value: '32500.5', selectionStart: 7 } });
    expect(toAmountInput.value).toBe('32,500.5');

    fireEvent.click(screen.getByRole('button', { name: '保存充值记录' }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(callArg(postSpy).toAmount).toBe(3250050);
  });

  it('"拿出多少"输入框粘贴带逗号数字不产生 NaN，来源/目标金额提交正确', async () => {
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(postSpy));

    render(<ExchangeForm tripId={TRIP_ID} wallets={WALLETS} />);

    fireEvent.click(screen.getByTestId('from-wallet-w1'));
    const fromAmountInput = screen.getByLabelText(/拿出多少/) as HTMLInputElement;
    fireEvent.change(fromAmountInput, { target: { value: '1,000', selectionStart: 5 } });
    expect(fromAmountInput.value).toBe('1,000');

    fireEvent.click(screen.getByTestId('to-wallet-w2'));
    const toAmountInput = screen.getByLabelText(/换到.*存多少/) as HTMLInputElement;
    fireEvent.change(toAmountInput, { target: { value: '8,000', selectionStart: 5 } });

    fireEvent.click(screen.getByRole('button', { name: '保存充值记录' }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const body = callArg(postSpy);
    expect(body.fromAmount).toBe(100000);
    expect(body.toAmount).toBe(800000);
    expect(Number.isNaN(body.fromAmount)).toBe(false);
    expect(Number.isNaN(body.toAmount)).toBe(false);
  });

  it('拆分到第二个钱包："存多少"+"存款手续费"两处都带千分位，提交后两条记录金额都正确（手续费从第二笔净额里扣）', async () => {
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(postSpy));

    render(<ExchangeForm tripId={TRIP_ID} wallets={WALLETS} />);

    fireEvent.click(screen.getByTestId('from-wallet-w1'));
    fireEvent.change(screen.getByLabelText(/拿出多少/), { target: { value: '1000', selectionStart: 4 } });
    fireEvent.click(screen.getByTestId('to-wallet-w2'));
    fireEvent.change(screen.getByLabelText(/换到.*存多少/), { target: { value: '30000', selectionStart: 5 } });

    fireEvent.click(screen.getByLabelText(/同时也拆一部分到另一个钱包/));
    fireEvent.click(screen.getByTestId('to-wallet-2-w3'));

    const toAmount2Input = screen.getByLabelText(/存多少（MYR）/) as HTMLInputElement;
    fireEvent.change(toAmount2Input, { target: { value: '5000', selectionStart: 4 } });
    expect(toAmount2Input.value).toBe('5,000');

    const depositFeeInput = screen.getByLabelText('存款手续费（可留空）') as HTMLInputElement;
    fireEvent.change(depositFeeInput, { target: { value: '50', selectionStart: 2 } });
    expect(depositFeeInput.value).toBe('50');

    fireEvent.click(screen.getByRole('button', { name: '保存充值记录' }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(2));

    const secondBody = callArg(postSpy, 1);
    // 5000 - 50 = 4950 元 = 495000 分（手续费直接从第二笔净入账金额里扣）。
    expect(secondBody.toAmount).toBe(495000);
  });

  it('非法字符被静默拒绝，展示值不变', () => {
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(postSpy));

    render(<ExchangeForm tripId={TRIP_ID} wallets={WALLETS} />);
    const toAmountInput = screen.getByLabelText(/换到.*存多少/) as HTMLInputElement;
    fireEvent.change(toAmountInput, { target: { value: '1,000', selectionStart: 5 } });
    expect(toAmountInput.value).toBe('1,000');
    fireEvent.change(toAmountInput, { target: { value: '1,000x', selectionStart: 6 } });
    expect(toAmountInput.value).toBe('1,000');
  });
});
