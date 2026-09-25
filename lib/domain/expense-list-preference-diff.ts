/**
 * 活动流（expense-list.tsx）排序模式 + 4 个筛选条件存档的内容比对——2026-09-26
 * 第七十一轮任务⑥新增，照抄 `fx-compare-preference-diff.ts` 那一套"零交互不 PUT"
 * 双保险里的第二层（内容比对）。第一层（`hasUserInteractedRef`，只在用户真实点
 * 筛选器/切排序模式时置 true）在 `expense-list.tsx` 里，跟 fx-compare-card.tsx
 * 同一个模式，不重复抄一遍原因，见那边的大注释。
 */

export interface ExpenseListPreferenceSnapshot {
  sortMode: string;
  categoryFilter: string;
  payerFilter: string;
  dateFilter: string;
  paymentMethodFilter: string;
}

/**
 * 两份存档内容是否等价（用于"要不要真的发一次 PUT"的判断）。
 * `null` 代表"还没有任何存档"，只有两边都是 `null` 才算相同——一边 null 一边有值
 * 一定是"变了"，必须放行写入（否则用户第一次真实操作产生的第一份存档永远发不出去）。
 */
export function isSameExpenseListPreference(
  a: ExpenseListPreferenceSnapshot | null,
  b: ExpenseListPreferenceSnapshot | null
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.sortMode === b.sortMode &&
    a.categoryFilter === b.categoryFilter &&
    a.payerFilter === b.payerFilter &&
    a.dateFilter === b.dateFilter &&
    a.paymentMethodFilter === b.paymentMethodFilter
  );
}
