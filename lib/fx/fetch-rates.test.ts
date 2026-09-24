import { describe, expect, it, vi } from 'vitest';
import { fetchMyrRates } from './fetch-rates';

function fakeFetch(response: { ok: boolean; json?: () => Promise<unknown> }): typeof fetch {
  return vi.fn().mockResolvedValue(response) as unknown as typeof fetch;
}

describe('fetchMyrRates', () => {
  it('正常返回时只挑出需要的币种，多余币种(JPY等)被过滤掉', async () => {
    const fetchImpl = fakeFetch({
      ok: true,
      json: async () => ({
        result: 'success',
        base_code: 'MYR',
        rates: { USD: 0.21, HKD: 1.65, THB: 7.6, PHP: 12.1, SGD: 0.29, LKR: 63.2, CNY: 1.53, JPY: 33.4 },
      }),
    });

    const rates = await fetchMyrRates(fetchImpl);

    expect(rates).toEqual({ USD: 0.21, HKD: 1.65, THB: 7.6, PHP: 12.1, SGD: 0.29, LKR: 63.2, CNY: 1.53 });
  });

  it('HTTP 非 2xx 时返回 null，不抛错', async () => {
    const fetchImpl = fakeFetch({ ok: false });
    const rates = await fetchMyrRates(fetchImpl);
    expect(rates).toBeNull();
  });

  it('JSON 形状不对(缺 rates 字段)时返回 null', async () => {
    const fetchImpl = fakeFetch({ ok: true, json: async () => ({ result: 'success' }) });
    const rates = await fetchMyrRates(fetchImpl);
    expect(rates).toBeNull();
  });

  it('rates 里全是非法值(非 number/负数)时返回 null', async () => {
    const fetchImpl = fakeFetch({ ok: true, json: async () => ({ rates: { USD: 'oops', HKD: -1 } }) });
    const rates = await fetchMyrRates(fetchImpl);
    expect(rates).toBeNull();
  });

  it('JSON 解析本身抛错时返回 null', async () => {
    const fetchImpl = fakeFetch({
      ok: true,
      json: async () => {
        throw new SyntaxError('unexpected token');
      },
    });
    const rates = await fetchMyrRates(fetchImpl);
    expect(rates).toBeNull();
  });

  it('fetch 本身网络异常(reject)时返回 null', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    const rates = await fetchMyrRates(fetchImpl);
    expect(rates).toBeNull();
  });

  it('fix(2026-09-24 超时守护)：请求真的带上了超时用的 AbortSignal，不是裸调用没有任何超时控制', async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
      capturedSignal = opts?.signal as AbortSignal | undefined;
      return Promise.resolve({ ok: true, json: async () => ({ rates: { USD: 0.21 } }) });
    }) as unknown as typeof fetch;

    await fetchMyrRates(fetchImpl);

    // 这条断言是这次修复的 mutation 验证：把 fetch-rates.ts 里的
    // `{ signal: AbortSignal.timeout(...) }` 删掉重新跑这条测试会失败
    // （capturedSignal 会是 undefined），证明这不是空壳测试。
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
  });

  it('fix(2026-09-24 超时守护)：请求被 abort(超时触发)时按既有网络异常路径返回 null，不抛错拖垮调用方', async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'TimeoutError'));
        });
        opts?.signal?.dispatchEvent(new Event('abort'));
      });
    }) as unknown as typeof fetch;

    const rates = await fetchMyrRates(fetchImpl);
    expect(rates).toBeNull();
  });
});
