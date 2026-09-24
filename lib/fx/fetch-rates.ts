/**
 * 拉 MYR 对目的地相关币种的即期汇率，源用免费不需要 key 的 open.er-api.com。
 * 一次请求拿 MYR 对所有币种的汇率，从里面只挑用得到的几个，不逐币种对分别打请求。
 *
 * fetch 通过参数注入，方便单测 mock，调用方（fx-recommendation 路由）负责把结果
 * 写回 exchange_rate_cache；这里只做「抓」，不碰数据库。抓不到（网络异常/HTTP
 * 非 2xx/JSON 形状不对）一律返回 null，不抛错——比价功能本来就不能因为外部
 * API 挂了阻塞记账，调用方按既有 unavailable 语义兜底即可。
 *
 * fix(2026-09-24，团队看板 id=2026-09-24_153503_855780ae)：这个请求之前完全没有
 * 超时控制——`ensureMyrRatesFresh`（`lib/fx/rate-cache.ts`）在缓存每 24 小时过期
 * 一次时会 `await` 这个函数，`app/trips/[tripId]/page.tsx` 又是服务端组件里直接
 * `await ensureMyrRatesFresh(...)` 挡在整页渲染前面——上游 API 只要挂起不响应
 * （不是报错，是真的不回），这条请求会无限期挂着，把整个行程主页一起拖死。
 * 加 `AbortSignal.timeout` 超时；扫过全项目（`grep fetch\(` 全部 app/lib 目录）
 * 确认这是整个代码库唯一一处打第三方外部 API 的地方（其余全部 `fetch()` 调用
 * 打的都是同源 `/api/...` 路由），没有既定的超时数值可以照抄，5 秒是这次新定的
 * 值——够一次正常的境外 API 往返，也不会让首屏卡出明显的"点了没反应"的等待感。
 * 超时会被下面的 try/catch 当成普通网络失败一样吞掉返回 null，跟原有的降级路径
 * （`ensureMyrRatesFresh` 保留现有缓存不清空、`getMyrRateSnapshot` 缺币种时
 * `deriveMidRate` 返回 undefined、页面按 undefined 直接不显示对应汇率/约算行）
 * 完全复用，不用另外写一条新的降级分支。
 */

export const FX_NEEDED_QUOTE_CURRENCIES = ['USD', 'HKD', 'THB', 'PHP', 'SGD', 'LKR', 'CNY'] as const;

export type MyrRates = Partial<Record<(typeof FX_NEEDED_QUOTE_CURRENCIES)[number], number>>;

const FX_FETCH_TIMEOUT_MS = 5000;

export async function fetchMyrRates(fetchImpl: typeof fetch = fetch): Promise<MyrRates | null> {
  let res: Response;
  try {
    res = await fetchImpl('https://open.er-api.com/v6/latest/MYR', {
      signal: AbortSignal.timeout(FX_FETCH_TIMEOUT_MS),
    });
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
