import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { exchangeRateCache, paymentMethods, trips } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { parseJsonBody } from '@/lib/http/validate';
import { fxRecommendationSchema } from '@/lib/validation/schemas';
import { recommendPaymentMethods } from '@/lib/domain/fx-recommendation';
import type { FxRateLookup } from '@/lib/domain/fx-recommendation';

interface Context {
  params: { tripId: string };
}

/**
 * 只用当日缓存里已有的汇率，v0.1 不在这里做外部汇率 API 实时拉取；
 * 查不到就让 recommendPaymentMethods 把该支付方式标 unavailable，
 * 不阻塞记账，前端提示用户改走手动输入。
 */
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

  const rateCache = await db.select().from(exchangeRateCache);
  const rateMap = new Map(rateCache.map((r) => [`${r.baseCurrency}->${r.quoteCurrency}`, r.rate]));

  const getMarketRate: FxRateLookup = (from, to) => {
    if (from === to) return 1;
    return rateMap.get(`${from}->${to}`) ?? null;
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
