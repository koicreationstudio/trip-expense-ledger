import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { walletBalanceHistory } from '../db/schema';

/**
 * 「谁是当前生效」的判断口径（round72 第三批，历史记录可直接编辑）——永远看
 * **这条钱包最近一次被创建的历史记录**（`changedAt` 最大的那条），跟这条记录
 * 自己的 `effectiveDate` 是哪一天完全无关。
 *
 * 这是故意的保守选择：如果编辑一条旧历史条目、把它的 `effectiveDate` 改到比
 * "当前生效"那条还晚，语义上会不会因此变成新的"当前生效"？这版的答案是不会——
 * `effectiveDate` 只是这条记录本身的一个属性，"当前生效"这个身份完全由创建
 * 顺序决定，不会被后续编辑动摇（详见 DESIGN-BRIEF-round72-balance-history-edit.html
 * ④屏留的悬案，这次落地时拍板选了"不算"这个更简单、更不容易让人困惑的分支）。
 *
 * 之所以不干脆在 UI 层直接拿"列表第 0 项"当结论（GET /balance-history 本来就
 * 按 changedAt 倒序），是因为后端这几个新端点（preview/PATCH/revert）各自都要
 * 独立判断一次"这条是不是当前生效"，不能指望调用方每次都记得自己先排序、自己
 * 数第 0 个——判断逻辑收在这一个函数里，直接查 DB 拿真相，不经手调用方传来的
 * 任何"看起来像"的中间结果。
 */
export async function isCurrentBalanceHistoryEntry(db: Db, walletId: string, historyId: string): Promise<boolean> {
  const latest = await db.query.walletBalanceHistory.findFirst({
    where: eq(walletBalanceHistory.walletId, walletId),
    orderBy: desc(walletBalanceHistory.changedAt),
  });
  return latest?.id === historyId;
}

export interface BalanceHistoryEditableFields {
  amount: number;
  effectiveDate: Date;
  originalAmount: number | null;
  originalEffectiveDate: Date | null;
}

/**
 * 纯函数，不摸 DB：给定这条历史记录现在的状态 + 这次编辑/还原的目标值，算出
 * 写库要用的 `originalAmount`/`originalEffectiveDate`/`amount`/`effectiveDate`
 * 四个字段。字段语义见 `lib/db/schema.ts` `wallet_balance_history` 表定义里
 * 这两个新字段的注释，这里只实现那份注释描述的规则，不重复贴一遍原因。
 *
 * - `isRevert=true`（还原）：目标值直接就是 `row.originalAmount`/
 *   `row.originalEffectiveDate`——调用方负责先检查这两个字段非 null 才会走到
 *   这个分支，这个函数本身不做这层校验（纯函数，不该替调用方决定"能不能还原"
 *   这件带业务含义的事）。还原完把原始值字段清空成 null。
 * - `isRevert=false`（正常编辑）：如果 `row.originalAmount` 已经非 null（这条
 *   之前被编辑过至少一次），原始值字段维持原样不动，保留最初那次的原始值；
 *   如果还是 null（这是第一次编辑这条记录），把原始值字段设成"编辑前"的
 *   `row.amount`/`row.effectiveDate`。
 */
export function computeHistoryEditFields(
  row: { amount: number; effectiveDate: Date; originalAmount: number | null; originalEffectiveDate: Date | null },
  target: { amount: number; effectiveDate: Date },
  isRevert: boolean
): BalanceHistoryEditableFields {
  if (isRevert) {
    return {
      amount: target.amount,
      effectiveDate: target.effectiveDate,
      originalAmount: null,
      originalEffectiveDate: null,
    };
  }

  const alreadyEditedBefore = row.originalAmount !== null;
  return {
    amount: target.amount,
    effectiveDate: target.effectiveDate,
    originalAmount: alreadyEditedBefore ? row.originalAmount : row.amount,
    originalEffectiveDate: alreadyEditedBefore ? row.originalEffectiveDate : row.effectiveDate,
  };
}
