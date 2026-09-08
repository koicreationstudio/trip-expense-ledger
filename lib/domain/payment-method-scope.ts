import { eq, type SQL } from 'drizzle-orm';
import { paymentMethods } from '../db/schema';

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
