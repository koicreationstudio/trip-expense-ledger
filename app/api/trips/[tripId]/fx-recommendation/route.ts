import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { exchangeRateCache, paymentMethods, trips } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { parseJsonBody } from '@/lib/http/validate';
import { fxRecommendationSchema } from '@/lib/validation/schemas';
import { recommendPaymentMethods } from '@/lib/domain/fx-recommendation';
import type { FxRateLookup } from '@/lib/domain/fx-recommendation';
import { paymentMethodOwnerFilter } from '@/lib/domain/payment-method-scope';
// fix(2026-09-24，Remy 真实反馈的真 bug)：她名下"现金"HKD/USD 两个支付方式
// label 完全一样，汇率比价卡片分不清是哪个——这个 chokepoint 在真正给 UI 用的
// 每一处（这个路由 + expenses/new、expenses/[expenseId]/edit 两个表单页）统一
// 消歧义，不在各自 UI 组件里各写一份判断，详见该文件顶部注释。
import { disambiguatePaymentMethodLabels } from '@/lib/domain/payment-method-label';
// fix(2026-09-17 第二十二轮)：`ensureRatesFresh` 抽到 `lib/fx/rate-cache.ts` 共享模块，
// 见那边的文件顶部注释——汇率比价卡的"渠道比价"这轮也要接同一份实时汇率，不能
// 两边各写一份现拉逻辑各自漂移。这个文件不再自己定义/写 exchange_rate_cache。
import { ensureMyrRatesFresh } from '@/lib/fx/rate-cache';

interface Context {
  params: { tripId: string };
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
    .where(and(paymentMethodOwnerFilter(identity), eq(paymentMethods.isActive, true)));

  if (methods.length === 0) {
    return NextResponse.json({ error: 'no_payment_methods' }, { status: 400 });
  }

  await ensureMyrRatesFresh(db, parsed.data.forceRefresh ?? false);

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

  const displayLabels = disambiguatePaymentMethodLabels(methods);

  const results = recommendPaymentMethods({
    amount: parsed.data.amount,
    expenseCurrency: parsed.data.expenseCurrency,
    // fix(2026-09-25，任务③)：不再写死行程本位币——调用方（汇率比价卡）现在会
    // 传"我持有"当前选中的币种，两者只有在旧场景（我持有===本位币）才刚好相等。
    // 不传时退回本位币，兼容还没升级的老调用方。
    compareCurrency: parsed.data.compareCurrency ?? trip.baseCurrency,
    paymentMethods: methods.map((m) => ({
      id: m.id,
      label: displayLabels.get(m.id) ?? m.label,
      kind: m.kind,
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
