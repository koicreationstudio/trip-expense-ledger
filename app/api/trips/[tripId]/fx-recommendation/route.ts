import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb, type Db } from '@/lib/db/client';
import { exchangeRateCache, paymentMethods, trips } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { parseJsonBody } from '@/lib/http/validate';
import { fxRecommendationSchema } from '@/lib/validation/schemas';
import { recommendPaymentMethods } from '@/lib/domain/fx-recommendation';
import type { FxRateLookup } from '@/lib/domain/fx-recommendation';
import { fetchMyrRates, FX_NEEDED_QUOTE_CURRENCIES } from '@/lib/fx/fetch-rates';

interface Context {
  params: { tripId: string };
}

const RATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 汇率缓存懒刷新：exchange_rate_cache 只在这里被写入。缺失或超过 24 小时没
 * 更新就现抓一次 open.er-api.com（一次请求换算全部需要的币种对，不逐个打），
 * 写回 MYR<->X 两个方向。抓取失败静默跳过，维持现有缓存（可能仍是空的），
 * 让 recommendPaymentMethods 按既有 unavailable 语义兜底，不阻塞记账。
 */
async function ensureRatesFresh(db: Db, forceRefresh: boolean): Promise<void> {
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

export const POST = withSession<Context>(async (request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const parsed = await parseJsonBody(request, fxRecommendationSchema);
  if ('error' in parsed) return parsed.error;

  const db = await getDb();
  const trip = await db.query.trips.findFirst({ where: eq(trips.id, params.tripId) });
  if (!trip) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const methods = await db
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.participantId, identity.participantId), eq(paymentMethods.isActive, true)));

  if (methods.length === 0) {
    return NextResponse.json({ error: 'no_payment_methods' }, { status: 400 });
  }

  await ensureRatesFresh(db, parsed.data.forceRefresh ?? false);

  const rateCache = await db.select().from(exchangeRateCache);
  const rateMap = new Map(rateCache.map((r) => [`${r.baseCurrency}->${r.quoteCurrency}`, r.rate]));

  // 缓存只存 MYR<->X 两个方向，两个非 MYR 币种之间(比如比价里常见的 THB
  // 消费 vs 支付宝 CNY 结算)没有直接缓存对，借 MYR 搭桥现算一次，不用为
  // 每一对非 MYR 币种组合额外存一份缓存。
  const getMarketRate: FxRateLookup = (from, to) => {
    if (from === to) return 1;
    const direct = rateMap.get(`${from}->${to}`);
    if (direct !== undefined) return direct;
    if (from !== 'MYR' && to !== 'MYR') {
      const fromToMyr = rateMap.get(`${from}->MYR`);
      const myrToTarget = rateMap.get(`MYR->${to}`);
      if (fromToMyr !== undefined && myrToTarget !== undefined) {
        return fromToMyr * myrToTarget;
      }
    }
    return null;
  };

  const results = recommendPaymentMethods({
    amount: parsed.data.amount,
    expenseCurrency: parsed.data.expenseCurrency,
    compareCurrency: trip.baseCurrency,
    paymentMethods: methods.map((m) => ({
      id: m.id,
      label: m.label,
      settlementCurrency: m.settlementCurrency,
      fxMarkupPercent: m.fxMarkupPercent,
      foreignTxnFeePercent: m.foreignTxnFeePercent,
      fixedFee: m.fixedFee,
      cashbackPercent: m.cashbackPercent,
    })),
    getMarketRate,
  });

  return NextResponse.json({ recommendations: results });
});
