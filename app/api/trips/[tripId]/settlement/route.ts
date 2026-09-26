import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { settlementSnapshots, trips } from '@/lib/db/schema';
import { assertSameTrip, withSession, withTripOwner } from '@/lib/auth/require-session';
import { loadSettlementInput, loadSettlementInputWithCurrency } from '@/lib/db/settlement-query';
import { computeNetBalances, computeSettlement, computeSettlementByCurrency } from '@/lib/domain/settlement';

interface Context {
  params: { tripId: string };
}

/**
 * 结算是唯一允许跨参与者读取的查询：任何参与者都能看到全体的净值和转账清单，
 * 但输出显式只列这几个字段，结构上不存在带出别人消费明细的可能。
 *
 * fix(2026-09-26，"结算按币种拆开显示")：`transfers` 现在按币种拆行——同一对
 * from/to 可能出现好几条，各自带自己的 currency + amountOriginal，不再是
 * "一对 from/to 一行"。
 */
export const GET = withSession<Context>(async (_request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const settlementInput = await loadSettlementInput(db, params.tripId);
  const netBalances = computeNetBalances(settlementInput);

  const settlementInputWithCurrency = await loadSettlementInputWithCurrency(db, params.tripId);
  const transfersByCurrency = computeSettlementByCurrency(settlementInputWithCurrency);
  const transfers = [...transfersByCurrency.values()].flat();

  return NextResponse.json({
    netBalances: [...netBalances.entries()].map(([participantId, netAmountBaseCurrency]) => ({
      participantId,
      netAmountBaseCurrency,
    })),
    transfers: transfers.map((t) => ({
      fromParticipantId: t.fromParticipantId,
      toParticipantId: t.toParticipantId,
      currency: t.currency,
      amountOriginal: t.amountOriginal,
      amountBaseCurrency: t.amountBaseCurrency,
    })),
  });
});

/** 标记「已结算」，冻结一份快照，仅 trip owner 能做，走 requireTripOwner 中间件。 */
export const POST = withTripOwner<Context>(async (_request, { params }, identity) => {
  const db = await getDb();
  const trip = await db.query.trips.findFirst({ where: eq(trips.id, params.tripId) });
  if (!trip) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (trip.status === 'settled') {
    return NextResponse.json({ error: 'already_settled' }, { status: 409 });
  }

  // fix(2026-09-26，"结算按币种拆开显示")：冻结快照现在也按币种拆行——
  // resultJson 从 [{from,to,amountBaseCurrency}] 改成 [{from,to,currency,amount}]，
  // 一对 from/to 现在可能有好几个币种，amount 是这一行"currency"这个具体币种下
  // 的原始金额（不是本位币金额——本位币金额已经有 baseCurrency 这个顶层字段
  // 兜底，这个数组里的 amount 特意存展示用的原始币种数字，跟结算页转账清单
  // 展示的是同一个数字）。这张表目前没有任何地方读取（只在标记已结算这一刻写，
  // 纯审计/历史记录用），语义解读的判断详见交接汇报。已有的旧快照不回填，
  // 冻结的意义就是不再变，原样保留旧格式。
  const settlementInputWithCurrency = await loadSettlementInputWithCurrency(db, params.tripId);
  const transfersByCurrency = computeSettlementByCurrency(settlementInputWithCurrency);
  const transfers = [...transfersByCurrency.values()].flat();
  const snapshotId = crypto.randomUUID();
  const resultJson = transfers.map((t) => ({
    fromParticipantId: t.fromParticipantId,
    toParticipantId: t.toParticipantId,
    currency: t.currency,
    amount: t.amountOriginal,
  }));

  // D1 的 remote binding 不支持交互式多语句事务（BEGIN/COMMIT），官方推荐用
  // batch() 做原子多语句写入——这两条语句互不依赖对方结果，符合 batch 的用法。
  await db.batch([
    db.insert(settlementSnapshots).values({
      id: snapshotId,
      tripId: params.tripId,
      computedAt: new Date(),
      baseCurrency: trip.baseCurrency,
      resultJson,
      createdByParticipantId: identity.participantId,
    }),
    db.update(trips).set({ status: 'settled' }).where(eq(trips.id, params.tripId)),
  ]);

  return NextResponse.json({ ok: true, snapshotId, transfers: resultJson });
});
