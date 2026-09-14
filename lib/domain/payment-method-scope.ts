import { and, eq, type SQL } from 'drizzle-orm';
import { paymentMethods, tripPaymentMethodEnabled } from '../db/schema';
import type { Db } from '../db/client';

/**
 * payment_method 双轨归属的唯一判断点：有账号（userId 非空）按 user_id 查，
 * 跨行程/跨 participant 都能查到同一份；guest（没注册账号）没有跨行程身份
 * 可以挂，退回 participant_id，只在这一趟行程内有效。
 * 所有读写 payment_method 的地方都要调这个 helper，不要各自重新写一遍判断。
 */
export function paymentMethodOwnerFilter(identity: {
  userId: string | null;
  participantId: string;
}): SQL {
  return identity.userId
    ? eq(paymentMethods.userId, identity.userId)
    : eq(paymentMethods.participantId, identity.participantId);
}

/** POST 新建支付方式时的归属字段：有账号挂 user_id，没账号才落 participant_id。 */
export function paymentMethodOwnerColumns(identity: { userId: string | null; participantId: string }): {
  userId: string | null;
  participantId: string | null;
} {
  return identity.userId
    ? { userId: identity.userId, participantId: null }
    : { userId: null, participantId: identity.participantId };
}

/**
 * 这个人名下的支付方式里，哪些 id 在这趟行程被勾了「启用」（trip_payment_method_enabled
 * 有对应一行）。只看这张关联表有没有行，不看 payment_method 本身任何字段；INNER JOIN
 * payment_method 顺带把归属过滤焊进同一次查询，不会读到别人挂在这趟行程下的启用行
 * （理论上不会有，因为写入这张表前一律先校验 payment_method 归属，双重保险不吃亏）。
 */
export async function loadEnabledPaymentMethodIds(
  db: Db,
  tripId: string,
  identity: { userId: string | null; participantId: string }
): Promise<Set<string>> {
  const rows = await db
    .select({ paymentMethodId: tripPaymentMethodEnabled.paymentMethodId })
    .from(tripPaymentMethodEnabled)
    .innerJoin(paymentMethods, eq(paymentMethods.id, tripPaymentMethodEnabled.paymentMethodId))
    .where(and(eq(tripPaymentMethodEnabled.tripId, tripId), paymentMethodOwnerFilter(identity)));
  return new Set(rows.map((r) => r.paymentMethodId));
}
