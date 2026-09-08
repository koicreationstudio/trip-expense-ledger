import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { participants, trips } from './schema';
import { loadSettlementInput } from './settlement-query';
import { computeNetBalances } from '../domain/settlement';

export interface UserTripSummary {
  id: string;
  name: string;
  baseCurrency: string;
  status: string;
  isOwner: boolean;
  participantId: string;
  netBalance: number;
}

/**
 * 查这个账号（Layer 2 userId）名下所有行程 + 各自净额。未登录首页的"我的行程"
 * 列表和行程内头部的切换入口共用同一份查询，不各自重写一遍
 * （DESIGN-BRIEF 第七版 D 节：这是行程切换器唯一需要的架构补丁）。
 */
export async function loadUserTripsWithBalance(db: Db, userId: string): Promise<UserTripSummary[]> {
  const rows = await db
    .select({
      id: trips.id,
      name: trips.name,
      baseCurrency: trips.baseCurrency,
      status: trips.status,
      isOwner: participants.isOwner,
      participantId: participants.id,
    })
    .from(participants)
    .innerJoin(trips, eq(participants.tripId, trips.id))
    .where(eq(participants.userId, userId));

  // 同一个账号可能在同一个行程里身兼两个身份（自己建的行程，又用邀请链接
  // 认领了里面另一个同行人占位），这时上面的查询会把同一个 trip 连出两行。
  // 按 trip.id 去重，创建者身份优先（那才是这个人在这个行程里的主身份，
  // 认领来的第二身份只是"顺手也记一份自己的账"，不该喧宾夺主）。
  const byTripId = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const existing = byTripId.get(row.id);
    if (!existing || (row.isOwner && !existing.isOwner)) {
      byTripId.set(row.id, row);
    }
  }
  const dedupedRows = Array.from(byTripId.values());

  return Promise.all(
    dedupedRows.map(async (row) => {
      const settlementInput = await loadSettlementInput(db, row.id);
      const netBalance = computeNetBalances(settlementInput).get(row.participantId) ?? 0;
      return { ...row, netBalance };
    })
  );
}
