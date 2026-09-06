import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { paymentMethods } from '@/lib/db/schema';
import { withSession } from '@/lib/auth/require-session';
import { toPaymentMethodDto } from '@/lib/http/dto';
import { parseJsonBody } from '@/lib/http/validate';
import { updatePaymentMethodSchema } from '@/lib/validation/schemas';

interface Context {
  params: { paymentMethodId: string };
}

async function loadOwn(id: string, participantId: string) {
  return db.query.paymentMethods.findFirst({
    where: and(eq(paymentMethods.id, id), eq(paymentMethods.participantId, participantId)),
  });
}

export const PATCH = withSession<Context>(async (request, { params }, identity) => {
  const existing = await loadOwn(params.paymentMethodId, identity.participantId);
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const parsed = await parseJsonBody(request, updatePaymentMethodSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  await db
    .update(paymentMethods)
    .set({
      label: body.label ?? existing.label,
      kind: body.kind ?? existing.kind,
      settlementCurrency: body.settlementCurrency ?? existing.settlementCurrency,
      fxMarkupPercent: body.fxMarkupPercent ?? existing.fxMarkupPercent,
      foreignTxnFeePercent: body.foreignTxnFeePercent ?? existing.foreignTxnFeePercent,
      fixedFee: body.fixedFee ?? existing.fixedFee,
      cashbackPercent: body.cashbackPercent ?? existing.cashbackPercent,
      sortOrder: body.sortOrder ?? existing.sortOrder,
      isActive: body.isActive ?? existing.isActive,
    })
    .where(eq(paymentMethods.id, params.paymentMethodId));

  const updated = await db.query.paymentMethods.findFirst({ where: eq(paymentMethods.id, params.paymentMethodId) });
  return NextResponse.json({ paymentMethod: toPaymentMethodDto(updated!) });
});

export const DELETE = withSession<Context>(async (_request, { params }, identity) => {
  const existing = await loadOwn(params.paymentMethodId, identity.participantId);
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await db.delete(paymentMethods).where(eq(paymentMethods.id, params.paymentMethodId));
  return new NextResponse(null, { status: 204 });
});
