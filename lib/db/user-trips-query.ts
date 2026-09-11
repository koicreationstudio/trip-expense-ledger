import { eq, inArray, sql } from 'drizzle-orm';
import type { Db } from './client';
import { expenses, participants, trips } from './schema';
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
  // 首页卡片"总消费汇总"行用，是整趟行程全部参与者的消费总和（不是当前用户一个人的），
  // 属于聚合层信息，跟 entered_by_participant_id 私密边界无关（跟 settlement 的
  // "结算是唯一允许跨参与者读取的查询"是同一类聚合口径，不展开逐笔明细）。
  totalExpenseBaseCurrency: number;
  expenseCount: number;
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
  const tripIds = dedupedRows.map((row) => row.id);

  // 每趟行程的消费总额+笔数，一次分组查询拿全部行程的汇总，不逐趟行程各查一次
  // （list-once 而不是 N+1，跟 R2 sync 那条"禁 HEAD-per-file"是同一条纪律的延伸）。
  // 故意不按 entered_by_participant_id 过滤：这行是行程层面的汇总，不是个人明细。
  //
  // 这条查询失败时不能让整个函数往上抛未捕获异常——loadUserTripsWithBalance
  // 是首页和 TripLayout（行程切换器）共用的入口，一炸就是两处一起变白屏
  // （ui-auditor 走查实测复现过一次 D1_ERROR，疑似本地 miniflare D1 模拟层
  // 偶发瞬时故障，不一定是这条查询本身的逻辑 bug，但不管是不是偶发，都不该
  // 让一条聚合汇总信息拖垮整个列表）。查询失败就降级成空 Map，totalsByTripId
  // 查不到时下面会 fallback 成 0/0，UI 那边 trip.expenseCount > 0 才渲染
  // "总消费"这行，0 就自动不显示，不需要额外改 UI 层。
  let totalsByTripId = new Map<string, { tripId: string; total: number; count: number }>();
  if (tripIds.length) {
    try {
      const expenseTotals = await db
        .select({
          tripId: expenses.tripId,
          total: sql<number>`coalesce(sum(${expenses.amountBaseCurrency}), 0)`,
          count: sql<number>`count(*)`,
        })
        .from(expenses)
        .where(inArray(expenses.tripId, tripIds))
        .groupBy(expenses.tripId);
      totalsByTripId = new Map(expenseTotals.map((row) => [row.tripId, row]));
    } catch (err) {
      console.error('loadUserTripsWithBalance: expenseTotals 聚合查询失败，降级为 0，不影响行程列表/净额正常返回', err);
    }
  }

  return Promise.all(
    dedupedRows.map(async (row) => {
      const settlementInput = await loadSettlementInput(db, row.id);
      const netBalance = computeNetBalances(settlementInput).get(row.participantId) ?? 0;
      const totals = totalsByTripId.get(row.id);
      return {
        ...row,
        netBalance,
        totalExpenseBaseCurrency: Number(totals?.total ?? 0),
        expenseCount: Number(totals?.count ?? 0),
      };
    })
  );
}
