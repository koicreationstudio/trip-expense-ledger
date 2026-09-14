import { asc } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { paymentMethods } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { toTripPaymentMethodDto } from '@/lib/http/dto';
import { paymentMethodOwnerFilter, loadEnabledPaymentMethodIds } from '@/lib/domain/payment-method-scope';

interface Context {
  params: { tripId: string };
}

/**
 * 「支付方式」页 + 「记一笔消费」页都要用的行程范围视图：这个人名下全部支付方式，
 * 每一条多带一个 `enabled` 布尔——是不是勾了「本行程启用」。跟账号范围的
 * `GET /api/payment-methods`（没有 enabled 字段）是两个不同用途的端点，不是替换关系：
 * 那个端点原样保留给不需要行程语境的调用方。
 */
export const GET = withSession<Context>(async (_request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const [rows, enabledIds] = await Promise.all([
    db
      .select()
      .from(paymentMethods)
      .where(paymentMethodOwnerFilter(identity))
      .orderBy(asc(paymentMethods.sortOrder)),
    loadEnabledPaymentMethodIds(db, params.tripId, identity),
  ]);

  return NextResponse.json({
    paymentMethods: rows.map((row) => toTripPaymentMethodDto(row, enabledIds.has(row.id))),
  });
});
