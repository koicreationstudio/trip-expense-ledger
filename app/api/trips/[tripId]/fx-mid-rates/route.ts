import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { ensureMyrRatesFresh, getMyrRateSnapshot } from '@/lib/fx/rate-cache';

interface Context {
  params: { tripId: string };
}

/**
 * 汇率比价卡"渠道比价"（Wise/TNG跨境/ATM/换钱店/支付宝）这轮改接真实中间汇率——
 * 2026-09-17 第二十二轮，Remy 明确要求"不再是写死数字"。这个端点跟
 * fx-recommendation 共用同一份 `exchange_rate_cache`/`ensureMyrRatesFresh`
 * （见 lib/fx/rate-cache.ts），但不要求这趟行程配置过支付方式——渠道比价本来
 * 就是纯汇率+固定点差算出来的，不该被"有没有配卡"这个跟它无关的前提拦住。
 * 返回的是"1 MYR = X <currency>"这张表，前端自己用 deriveMidRate 换算任意
 * 两个币种之间的汇率（同一份换算规则见 lib/fx/rate-cache.ts 的 deriveMidRate）。
 */
export const GET = withSession<Context>(async (request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const forceRefresh = new URL(request.url).searchParams.get('forceRefresh') === '1';
  await ensureMyrRatesFresh(db, forceRefresh);
  const snapshot = await getMyrRateSnapshot(db);

  return NextResponse.json({
    base: 'MYR',
    rates: snapshot.rates,
    fetchedAt: snapshot.oldestFetchedAt ? snapshot.oldestFetchedAt.toISOString() : null,
    stale: snapshot.stale,
  });
});
