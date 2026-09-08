import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb, type Db } from '@/lib/db/client';
import { exchangeRecords, paymentMethods, wallets } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { toWalletDto } from '@/lib/http/dto';
import { parseJsonBody } from '@/lib/http/validate';
import { updateWalletSchema } from '@/lib/validation/schemas';
import { paymentMethodOwnerFilter } from '@/lib/domain/payment-method-scope';

interface Context {
  params: { tripId: string; walletId: string };
}

async function loadOwn(db: Db, id: string, tripId: string, participantId: string) {
  return db.query.wallets.findFirst({
    where: and(eq(wallets.id, id), eq(wallets.tripId, tripId), eq(wallets.participantId, participantId)),
  });
}

export const PATCH = withSession<Context>(async (request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const existing = await loadOwn(db, params.walletId, params.tripId, identity.participantId);
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const parsed = await parseJsonBody(request, updateWalletSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  if (body.paymentMethodId) {
    const owns = await db.query.paymentMethods.findFirst({
      where: and(eq(paymentMethods.id, body.paymentMethodId), paymentMethodOwnerFilter(identity)),
    });
    if (!owns) return NextResponse.json({ error: 'invalid_payment_method' }, { status: 400 });
  }

  await db
    .update(wallets)
    .set({
      label: body.label ?? existing.label,
      emoji: body.emoji ?? existing.emoji,
      paymentMethodId: body.paymentMethodId === undefined ? existing.paymentMethodId : body.paymentMethodId,
      currentBalance: body.currentBalance ?? existing.currentBalance,
    })
    .where(eq(wallets.id, params.walletId));

  const updated = await db.query.wallets.findFirst({ where: eq(wallets.id, params.walletId) });
  return NextResponse.json({ wallet: toWalletDto(updated!) });
});

/**
 * 删钱包前先查有没有关联的换汇记录——有的话直接删会留下指向不存在钱包的
 * from/to 引用（schema 里 from_wallet_id 是 set null、to_wallet_id 是 cascade，
 * 硬删不会报错，但会悄悄抹掉一笔换汇记录的历史，这里选择更安全的做法：
 * 有关联记录就拒绝删除，跟项目里「删除有关联数据」的其它地方保持一样的谨慎程度）。
 */
export const DELETE = withSession<Context>(async (_request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const existing = await loadOwn(db, params.walletId, params.tripId, identity.participantId);
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const linkedRecord = await db.query.exchangeRecords.findFirst({
    where: and(
      eq(exchangeRecords.participantId, identity.participantId),
      eq(exchangeRecords.toWalletId, params.walletId)
    ),
  });
  const linkedAsSource = await db.query.exchangeRecords.findFirst({
    where: and(
      eq(exchangeRecords.participantId, identity.participantId),
      eq(exchangeRecords.fromWalletId, params.walletId)
    ),
  });
  if (linkedRecord || linkedAsSource) {
    return NextResponse.json({ error: 'wallet_has_exchange_records' }, { status: 409 });
  }

  await db.delete(wallets).where(eq(wallets.id, params.walletId));
  return new NextResponse(null, { status: 204 });
});
