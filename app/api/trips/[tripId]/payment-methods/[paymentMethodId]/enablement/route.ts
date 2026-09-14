import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { paymentMethods, tripPaymentMethodEnabled } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { parseJsonBody } from '@/lib/http/validate';
import { updatePaymentMethodEnablementSchema } from '@/lib/validation/schemas';
import { paymentMethodOwnerFilter } from '@/lib/domain/payment-method-scope';

interface Context {
  params: { tripId: string; paymentMethodId: string };
}

/**
 * 「本行程启用的支付方式」勾选/取消勾选（2026-09-15 落地 Artifact Version 10 遗留
 * 缺口）。PUT body `{ enabled: boolean }`——勾选＝插一行 trip_payment_method_enabled，
 * 取消＝删那一行，行存在即启用，不用一个 boolean 列表示状态（复用 settlement_confirmation
 * 表已经用过的同一个设计取舍：见 schema.ts 顶部注释）。
 */
export const PUT = withSession<Context>(async (request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const parsed = await parseJsonBody(request, updatePaymentMethodEnablementSchema);
  if ('error' in parsed) return parsed.error;

  const db = await getDb();
  // 先确认这个支付方式真的是自己的，不接受传别人的 id 来污染这趟行程的启用表。
  const owns = await db.query.paymentMethods.findFirst({
    where: and(eq(paymentMethods.id, params.paymentMethodId), paymentMethodOwnerFilter(identity)),
  });
  if (!owns) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (parsed.data.enabled) {
    await db
      .insert(tripPaymentMethodEnabled)
      .values({ id: crypto.randomUUID(), tripId: params.tripId, paymentMethodId: params.paymentMethodId })
      .onConflictDoNothing();
  } else {
    await db
      .delete(tripPaymentMethodEnabled)
      .where(
        and(
          eq(tripPaymentMethodEnabled.tripId, params.tripId),
          eq(tripPaymentMethodEnabled.paymentMethodId, params.paymentMethodId)
        )
      );
  }

  return NextResponse.json({ enabled: parsed.data.enabled });
});
