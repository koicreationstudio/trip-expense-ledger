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

  return Promise.all(
    rows.map(async (row) => {
      const settlementInput = await loadSettlementInput(db, row.id);
      const netBalance = computeNetBalances(settlementInput).get(row.participantId) ?? 0;
      return { ...row, netBalance };
    })
  );
}
