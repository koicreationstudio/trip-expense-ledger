import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { participants, sessions } from '../db/schema';

export const SESSION_COOKIE_NAME = 'tel_session';

/** 明文 token，会被塞进 httpOnly cookie 下发给浏览器，DB 里永远不存明文。 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** 参与者认领身份成功后调用，建一条新 session 并返回要塞进 cookie 的明文 token。 */
export async function createSession(
  db: Db,
  participantId: string,
  userAgent: string | null
): Promise<string> {
  const token = generateSessionToken();
  await db.insert(sessions).values({
    participantId,
    tokenHash: hashToken(token),
    userAgent,
  });
  return token;
}

export interface AuthenticatedIdentity {
  participantId: string;
  tripId: string;
  isOwner: boolean;
}

/**
 * 从请求带来的 cookie token 反查身份。
 * 找不到（token 无效/session 被清空）一律返回 null，调用方应把请求当未登录处理，
 * 不允许把"查不到"悄悄当成任何一种默认身份。
 */
export async function resolveIdentity(db: Db, token: string | undefined): Promise<AuthenticatedIdentity | null> {
  if (!token) return null;

  const tokenHash = hashToken(token);
  const row = await db
    .select({
      participantId: participants.id,
      tripId: participants.tripId,
      isOwner: participants.isOwner,
    })
    .from(sessions)
    .innerJoin(participants, eq(sessions.participantId, participants.id))
    .where(eq(sessions.tokenHash, tokenHash))
    .get();

  if (!row) return null;

  await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.tokenHash, tokenHash));

  return row;
}

/** 撤销某个参与者的全部 session，用于「重置认领」纠错场景。 */
export async function revokeAllSessions(db: Db, participantId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.participantId, participantId));
}
