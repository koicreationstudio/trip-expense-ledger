import crypto from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { invites, participants } from '../db/schema';

/** 邀请码本身就是权限凭证，必须不可猜测，用 32 字节随机数、base64url 编码。 */
export function generateInviteCode(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export interface InviteView {
  tripId: string;
  tripName: string;
  /** 尚未被认领的名字占位，前端只能从这份名单里选，选不到已认领的人 */
  unclaimedParticipants: { id: string; displayName: string }[];
}

export type InviteLookupResult =
  | { status: 'ok'; view: InviteView }
  | { status: 'not_found' }
  | { status: 'expired' }
  | { status: 'revoked' }
  | { status: 'full' };

/**
 * 校验邀请码状态 + 拉出可认领名单。
 * 找不到/过期/撤销都返回统一的失败态，不区分"不存在"和"存在但失效"，
 * 避免向持有失效链接的人泄露"这条邀请曾经存在过"这类信息。
 */
export async function lookupInvite(db: Db, code: string): Promise<InviteLookupResult> {
  const invite = await db.query.invites.findFirst({
    where: eq(invites.code, code),
    with: { trip: true },
  });

  if (!invite) return { status: 'not_found' };
  if (invite.revokedAt) return { status: 'revoked' };
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) return { status: 'expired' };

  const unclaimed = await db
    .select({ id: participants.id, displayName: participants.displayName })
    .from(participants)
    .where(and(eq(participants.tripId, invite.tripId), isNull(participants.claimedAt)));

  if (unclaimed.length === 0) return { status: 'full' };

  return {
    status: 'ok',
    view: {
      tripId: invite.tripId,
      tripName: invite.trip.name,
      unclaimedParticipants: unclaimed,
    },
  };
}

export type ClaimResult =
  | { status: 'ok'; participantId: string }
  | { status: 'already_claimed' }
  | { status: 'not_found' };

/**
 * 认领一个名字占位。并发下两个人同时点同一个名字只能有一个人成功，
 * 靠 UPDATE ... WHERE claimed_at IS NULL 的原子性做互斥，不是先查后写。
 */
export async function claimParticipant(db: Db, participantId: string): Promise<ClaimResult> {
  const result = await db
    .update(participants)
    .set({ claimedAt: new Date() })
    .where(and(eq(participants.id, participantId), isNull(participants.claimedAt)))
    .returning({ id: participants.id });

  if (result.length > 0) return { status: 'ok', participantId };

  const existing = await db.query.participants.findFirst({ where: eq(participants.id, participantId) });
  if (!existing) return { status: 'not_found' };
  return { status: 'already_claimed' };
}
