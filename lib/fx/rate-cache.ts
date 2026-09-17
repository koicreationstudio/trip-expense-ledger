import { eq } from 'drizzle-orm';
import type { Db } from '@/lib/db/client';
import { exchangeRateCache } from '@/lib/db/schema';
import { fetchMyrRates, FX_NEEDED_QUOTE_CURRENCIES } from './fetch-rates';

/**
 * MYR 基准汇率缓存的共享 chokepoint——2026-09-17 第二十二轮从
 * `app/api/trips/[tripId]/fx-recommendation/route.ts` 里抽出来的，之前
 * `ensureRatesFresh` 只活在那一个路由文件里，只服务"我的支付方式"比价。
 * 这轮汇率比价卡的"渠道比价"（Wise/TNG跨境/ATM/换钱店/支付宝）也要改接
 * 真实中间汇率，如果照抄一份 `ensureRatesFresh` 各写各的，两边各自现拉
 * 一次、各自决定要不要刷新，容易慢慢跑偏（比如 TTL 改了只改一边）——所以
 * 抽成共享模块，两个路由调用同一份实现，缓存表 `exchange_rate_cache` 也
 * 只有这一处代码在写。
 */

const RATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 缓存懒刷新：缺失或超过 24 小时没更新就现抓一次 open.er-api.com（一次
 * 请求换算全部需要的币种对，不逐个打），写回 MYR<->X 两个方向。抓取失败
 * 静默跳过，维持现有缓存（可能仍是空的/旧的），调用方按各自的 unavailable/
 * stale 语义兜底，不阻塞记账/比价。
 */
export async function ensureMyrRatesFresh(db: Db, forceRefresh: boolean): Promise<void> {
  const now = Date.now();
  const existing = await db.select().from(exchangeRateCache).where(eq(exchangeRateCache.baseCurrency, 'MYR'));
  const freshQuotes = new Set(
    existing.filter((r) => now - r.fetchedAt.getTime() < RATE_CACHE_TTL_MS).map((r) => r.quoteCurrency)
  );

  const needsRefresh = forceRefresh || FX_NEEDED_QUOTE_CURRENCIES.some((c) => !freshQuotes.has(c));
  if (!needsRefresh) return;

  const rates = await fetchMyrRates();
  if (!rates) return;

  const fetchedAt = new Date(now);
  const statements = Object.entries(rates).flatMap(([quote, rate]) => [
    db
      .insert(exchangeRateCache)
      .values({ baseCurrency: 'MYR', quoteCurrency: quote, rate: rate as number, fetchedAt, source: 'open-er-api' })
      .onConflictDoUpdate({
        target: [exchangeRateCache.baseCurrency, exchangeRateCache.quoteCurrency],
        set: { rate: rate as number, fetchedAt, source: 'open-er-api' },
      }),
    db
      .insert(exchangeRateCache)
      .values({
        baseCurrency: quote,
        quoteCurrency: 'MYR',
        rate: 1 / (rate as number),
        fetchedAt,
        source: 'open-er-api',
      })
      .onConflictDoUpdate({
        target: [exchangeRateCache.baseCurrency, exchangeRateCache.quoteCurrency],
        set: { rate: 1 / (rate as number), fetchedAt, source: 'open-er-api' },
      }),
  ]);

  await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
}

export interface MyrRateSnapshot {
  /** 1 MYR = rates[X] 个 X；MYR 自己恒为 1，方便调用方统一按 Record 查表不用特判 base。 */
  rates: Record<string, number>;
  /** 这批缓存里最旧的一条 fetchedAt，前端拿来显示"更新于..."；一条都没有时为 null。 */
  oldestFetchedAt: Date | null;
  /** true = 至少一种需要的币种缓存缺失，或者超过 TTL 没刷新——仍然把能查到的都给出去，
   * 调用方决定要不要提示"这是离线/旧汇率"。 */
  stale: boolean;
}

/** 读当前缓存快照，不负责刷新——调用前应该先 `ensureMyrRatesFresh`。 */
export async function getMyrRateSnapshot(db: Db): Promise<MyrRateSnapshot> {
  const rows = await db.select().from(exchangeRateCache).where(eq(exchangeRateCache.baseCurrency, 'MYR'));
  const now = Date.now();
  const rates: Record<string, number> = { MYR: 1 };
  const rowMap = new Map(rows.map((r) => [r.quoteCurrency, r]));

  let oldestFetchedAt: Date | null = null;
  let stale = false;
  for (const currency of FX_NEEDED_QUOTE_CURRENCIES) {
    const row = rowMap.get(currency);
    if (!row) {
      stale = true;
      continue;
    }
    rates[currency] = row.rate;
    if (now - row.fetchedAt.getTime() >= RATE_CACHE_TTL_MS) stale = true;
    if (!oldestFetchedAt || row.fetchedAt < oldestFetchedAt) oldestFetchedAt = row.fetchedAt;
  }

  return { rates, oldestFetchedAt, stale };
}

// deriveMidRate（"1 MYR=X"快照 → 任意两币种中间汇率）单独放在 derive-mid-rate.ts——
// 那个文件是纯函数、零依赖，客户端组件（fx-compare-card.tsx）也要用同一份换算规则，
// 不能因为这个文件 import 了 drizzle/db 类型就没法被 'use client' 组件引用。
export { deriveMidRate } from './derive-mid-rate';
