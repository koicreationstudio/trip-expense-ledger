/**
 * 拉 MYR 对目的地相关币种的即期汇率，源用免费不需要 key 的 open.er-api.com。
 * 一次请求拿 MYR 对所有币种的汇率，从里面只挑用得到的几个，不逐币种对分别打请求。
 *
 * fetch 通过参数注入，方便单测 mock，调用方（fx-recommendation 路由）负责把结果
 * 写回 exchange_rate_cache；这里只做「抓」，不碰数据库。抓不到（网络异常/HTTP
 * 非 2xx/JSON 形状不对）一律返回 null，不抛错——比价功能本来就不能因为外部
 * API 挂了阻塞记账，调用方按既有 unavailable 语义兜底即可。
 */

export const FX_NEEDED_QUOTE_CURRENCIES = ['USD', 'HKD', 'THB', 'PHP', 'SGD', 'LKR', 'CNY'] as const;

export type MyrRates = Partial<Record<(typeof FX_NEEDED_QUOTE_CURRENCIES)[number], number>>;

export async function fetchMyrRates(fetchImpl: typeof fetch = fetch): Promise<MyrRates | null> {
  let res: Response;
  try {
    res = await fetchImpl('https://open.er-api.com/v6/latest/MYR');
  } catch {
    return null;
  }

  if (!res.ok) return null;

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return null;
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    !('rates' in body) ||
    typeof (body as { rates: unknown }).rates !== 'object' ||
    (body as { rates: unknown }).rates === null
  ) {
    return null;
  }

  const rates = (body as { rates: Record<string, unknown> }).rates;
  const result: MyrRates = {};
  for (const currency of FX_NEEDED_QUOTE_CURRENCIES) {
    const rate = rates[currency];
    if (typeof rate === 'number' && rate > 0) {
      result[currency] = rate;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}
