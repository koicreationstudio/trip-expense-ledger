import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { settlementSnapshots, trips } from '@/lib/db/schema';
import { assertSameTrip, withSession, withTripOwner } from '@/lib/auth/require-session';
import { loadSettlementInput } from '@/lib/db/settlement-query';
import { computeNetBalances, computeSettlement } from '@/lib/domain/settlement';

interface Context {
  params: { tripId: string };
}

/**
 * 结算是唯一允许跨参与者读取的查询：任何参与者都能看到全体的净值和转账清单，
 * 但输出显式只列这三个字段，结构上不存在带出别人消费明细的可能。
 */
export const GET = withSession<Context>(async (_request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const settlementInput = await loadSettlementInput(db, params.tripId);
  const netBalances = computeNetBalances(settlementInput);
  const transfers = computeSettlement(settlementInput);

  return NextResponse.json({
    netBalances: [...netBalances.entries()].map(([participantId, netAmountBaseCurrency]) => ({
      participantId,
      netAmountBaseCurrency,
    })),
    transfers: transfers.map((t) => ({
      fromParticipantId: t.fromParticipantId,
      toParticipantId: t.toParticipantId,
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

  const settlementInput = await loadSettlementInput(db, params.tripId);
  const transfers = computeSettlement(settlementInput);
  const snapshotId = crypto.randomUUID();
  const resultJson = transfers.map((t) => ({
    fromParticipantId: t.fromParticipantId,
    toParticipantId: t.toParticipantId,
    amountBaseCurrency: t.amountBaseCurrency,
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
