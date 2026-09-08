import { asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { paymentMethods } from '@/lib/db/schema';
import { withSession } from '@/lib/auth/require-session';
import { toPaymentMethodDto } from '@/lib/http/dto';
import { parseJsonBody } from '@/lib/http/validate';
import { createPaymentMethodSchema } from '@/lib/validation/schemas';
import { paymentMethodOwnerColumns, paymentMethodOwnerFilter } from '@/lib/domain/payment-method-scope';

/** 支付方式永远挂在 session 解出的自己身上，不接受传 participantId 指定别人。 */
export const GET = withSession(async (_request, _context, identity) => {
  const db = await getDb();
  const rows = await db
    .select()
    .from(paymentMethods)
    .where(paymentMethodOwnerFilter(identity))
    .orderBy(asc(paymentMethods.sortOrder));

  return NextResponse.json({ paymentMethods: rows.map(toPaymentMethodDto) });
});

export const POST = withSession(async (request, _context, identity) => {
  const db = await getDb();
  const parsed = await parseJsonBody(request, createPaymentMethodSchema);
  if ('error' in parsed) return parsed.error;

  const id = crypto.randomUUID();
  await db.insert(paymentMethods).values({ id, ...paymentMethodOwnerColumns(identity), ...parsed.data });

  const created = await db.query.paymentMethods.findFirst({ where: eq(paymentMethods.id, id) });
  return NextResponse.json({ paymentMethod: toPaymentMethodDto(created!) }, { status: 201 });
});
