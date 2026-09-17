/**
 * 纯函数、零依赖——给定一份"1 MYR = X"快照（`lib/fx/rate-cache.ts` 的
 * `MyrRateSnapshot.rates`，MYR 自己恒为 1），推出任意两个币种之间的中间汇率
 * （1 from = ? to）。
 *
 * 单独拆成这个零依赖文件，是因为它同时被两处调用：服务器端（如果以后有需要）
 * 和 `app/trips/[tripId]/fx-compare-card.tsx` 这个 'use client' 组件。
 * `lib/fx/rate-cache.ts` 那边 import 了 drizzle/db 相关类型，不能被客户端组件
 * 直接 import（会把服务器端代码打进客户端 bundle），拆出来才能让两边共用同
 * 一份换算规则，不用各写一份容易漂移。
 *
 * from/to 有一个查不到就返回 undefined，不抛错——调用方按各自的兜底语义处理
 * （渠道比价用固定参考表兜底、支付方式比价走 unavailable）。
 */
export function deriveMidRate(
  rates: Record<string, number> | null | undefined,
  from: string,
  to: string
): number | undefined {
  if (!rates) return undefined;
  const fromRate = rates[from];
  const toRate = rates[to];
  if (fromRate === undefined || toRate === undefined || fromRate === 0) return undefined;
  return toRate / fromRate;
}
