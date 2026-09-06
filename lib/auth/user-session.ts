import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { users, userSessions } from '../db/schema';

/**
 * Layer 2（账号系统）登录态，形状完全照抄 lib/auth/session.ts（Layer 1）。
 * 用独立的 cookie 名字，跟 Layer 1 的 tel_session 平行存在、互不干扰：
 * 这个 cookie 只负责「记住这个人是谁」，不参与任何一条现有 API 的权限判断。
 */
export const USER_SESSION_COOKIE_NAME = 'tel_user_session';

export function generateUserSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashUserToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** 注册/登录成功后调用，建一条新 user_session 并返回要塞进 cookie 的明文 token。 */
export async function createUserSession(
  db: Db,
  userId: string,
  userAgent: string | null
): Promise<string> {
  const token = generateUserSessionToken();
  await db.insert(userSessions).values({
    userId,
    tokenHash: hashUserToken(token),
    userAgent,
  });
  return token;
}

export interface AuthenticatedUser {
  userId: string;
  email: string;
  displayName: string;
}

/**
 * 从请求带来的 cookie token 反查账号身份。
 * 找不到（token 无效/session 被清空）一律返回 null，不允许把"查不到"悄悄当成任何一种默认身份。
 */
export async function resolveUser(db: Db, token: string | undefined): Promise<AuthenticatedUser | null> {
  if (!token) return null;

  const tokenHash = hashUserToken(token);
  const row = await db
    .select({
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(userSessions)
    .innerJoin(users, eq(userSessions.userId, users.id))
    .where(eq(userSessions.tokenHash, tokenHash))
    .get();

  if (!row) return null;

  await db.update(userSessions).set({ lastSeenAt: new Date() }).where(eq(userSessions.tokenHash, tokenHash));

  return row;
}

/** 撤销某一条 user_session（当前这个浏览器的登录态），用于 logout。 */
export async function revokeUserSession(db: Db, token: string): Promise<void> {
  await db.delete(userSessions).where(eq(userSessions.tokenHash, hashUserToken(token)));
}
