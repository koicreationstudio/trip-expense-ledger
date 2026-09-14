import { asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { paymentMethods, tripPaymentMethodEnabled } from '@/lib/db/schema';
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
  // tripId 只用来决定「新建的这个支付方式要不要在这趟行程默认启用」，不落进
  // payment_method 表本身（那张表没有 trip_id 列，见 schema.ts 顶部注释）。
  const { tripId, ...values } = parsed.data;

  const id = crypto.randomUUID();
  await db.insert(paymentMethods).values({ id, ...paymentMethodOwnerColumns(identity), ...values });

  // 「支付方式」页现在是行程内路由，新建的支付方式对当前正看着的这趟行程默认启用，
  // 呼应 Artifact 截图里新建完直接是勾选态——只有传了 tripId（且真的是自己当前所在
  // 的那趟行程）才做这一步，避免以后有别的不带行程语境的入口误开这个默认值。
  if (tripId && tripId === identity.tripId) {
    await db.insert(tripPaymentMethodEnabled).values({ id: crypto.randomUUID(), tripId, paymentMethodId: id });
  }

  const created = await db.query.paymentMethods.findFirst({ where: eq(paymentMethods.id, id) });
  return NextResponse.json({ paymentMethod: toPaymentMethodDto(created!) }, { status: 201 });
});
