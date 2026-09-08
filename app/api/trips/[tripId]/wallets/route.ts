import { and, asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { paymentMethods, wallets } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { toWalletDto } from '@/lib/http/dto';
import { parseJsonBody } from '@/lib/http/validate';
import { createWalletSchema } from '@/lib/validation/schemas';

interface Context {
  params: { tripId: string };
}

/**
 * 钱包私有：硬编码 participant_id = 自己，不接受任何客户端传参覆盖这个过滤条件——
 * 跟 CLAUDE.md 权限边界里 expense 查询的规矩是同一条。
 */
export const GET = withSession<Context>(async (_request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const rows = await db
    .select()
    .from(wallets)
    .where(and(eq(wallets.tripId, params.tripId), eq(wallets.participantId, identity.participantId)))
    .orderBy(asc(wallets.createdAt));

  return NextResponse.json({ wallets: rows.map(toWalletDto) });
});

export const POST = withSession<Context>(async (request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const parsed = await parseJsonBody(request, createWalletSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  if (body.paymentMethodId) {
    const owns = await db.query.paymentMethods.findFirst({
      where: and(eq(paymentMethods.id, body.paymentMethodId), eq(paymentMethods.participantId, identity.participantId)),
    });
    if (!owns) return NextResponse.json({ error: 'invalid_payment_method' }, { status: 400 });
  }

  const id = crypto.randomUUID();
  await db.insert(wallets).values({
    id,
    tripId: params.tripId,
    participantId: identity.participantId,
    label: body.label,
    currency: body.currency,
    emoji: body.emoji,
    currentBalance: body.initialBalance,
    paymentMethodId: body.paymentMethodId ?? null,
  });

  const created = await db.query.wallets.findFirst({ where: eq(wallets.id, id) });
  return NextResponse.json({ wallet: toWalletDto(created!) }, { status: 201 });
});
