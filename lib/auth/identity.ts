import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { users, participants } from '../db/schema';
import { resolveIdentity, SESSION_COOKIE_NAME } from './session';
import { createUserSession } from './user-session';

/**
 * 专属身份直连链接的 token：形状/存储哲学照抄 lib/auth/invite.ts 的
 * generateInviteCode()——32 字节随机数，base64url 编码，明文存进 DB
 * （不哈希，Remy 明确要求"明文存储"，这条 token 本身就是权限凭证，
 * 跟邀请码是同一类东西）。
 */
export function generateIdentityToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export interface ProvisionResult {
  userId: string;
  identityToken: string;
  sessionToken: string;
}

/**
 * 全新开号：邮箱密码登录砍掉后，第一次进 /trips/new 没有账号时调用这个。
 * displayName 留空——真正给同行人看的名字是每趟行程各自的 ownerDisplayName，
 * 这张表的 displayName 字段这轮起不再有实际用途（历史遗留字段，NOT NULL
 * 约束还在，给空字符串满足约束就好，不额外产出用户看得到的"账号昵称"概念）。
 */
export async function provisionUser(db: Db, userAgent: string | null): Promise<ProvisionResult> {
  const userId = crypto.randomUUID();
  const identityToken = generateIdentityToken();
  await db.insert(users).values({ id: userId, identityToken, displayName: '' });
  const sessionToken = await createUserSession(db, userId, userAgent);
  return { userId, identityToken, sessionToken };
}

/**
 * "顺手关联"：把当前请求自己的 Layer 1 tel_session（比如刚认领完邀请，或者
 * 刚建完行程还没走到这一步）指向的 participant 关联到刚登录的账号。
 * 只认当前请求自己的 session，不接受任何外部传参指定 participantId——这是
 * 第八轮修过的安全边界（claim 路由那次"看 cookie 就绑"漏洞的教训），
 * app/api/account/link-current-trip/route.ts 和 app/id/[token]/route.ts
 * 两处都调用这一个函数，不重复实现。
 */
export async function linkCurrentTripSession(
  db: Db,
  userId: string,
  tripSessionToken: string | undefined
): Promise<{ ok: boolean; tripId?: string }> {
  const identity = await resolveIdentity(db, tripSessionToken);
  if (!identity) return { ok: false };

  await db.update(participants).set({ userId }).where(eq(participants.id, identity.participantId));
  return { ok: true, tripId: identity.tripId };
}

// re-export 方便调用方按需引入，不用同时 import 两个模块拿 cookie 名
export { SESSION_COOKIE_NAME };
