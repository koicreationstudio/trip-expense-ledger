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
});
