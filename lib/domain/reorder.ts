/**
 * 活动流手动排序拖拽——纯函数部分（2026-09-26 第七十一轮，任务⑤）。
 *
 * 拆成纯函数放这里是这个项目一贯的做法（跟 `deriveMidRate`/`quick-base-grid.ts`
 * 同一个理由，见那两个文件顶部注释）：拖拽交互本身（指针事件/长按计时器/DOM 测量）
 * 只能在组件里测手动/真机走查，但"给定一份 id 顺序 + 把第几项挪到第几项"这个
 * 纯粹的数组操作可以脱离 DOM 单独单测覆盖，不用每次改交互细节都要连带重新验证
 * 这一段逻辑对不对。
 */

/**
 * 把 `ids[fromIndex]` 移动到 `toIndex` 这个位置，返回一份新数组（不改原数组）。
 * 下标越界会被夹在合法范围内，不抛错——拖拽过程中指针可能短暂滑出列表可见范围，
 * 调用方没必要每次都自己先夹一遍范围。
 */
export function moveItem<T>(ids: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (ids.length === 0) return [];
  const clampedFrom = Math.max(0, Math.min(ids.length - 1, fromIndex));
  const clampedTo = Math.max(0, Math.min(ids.length - 1, toIndex));
  const next = [...ids];
  const [moved] = next.splice(clampedFrom, 1);
  next.splice(clampedTo, 0, moved as T);
  return next;
}

/**
 * 两份顺序是否完全一致（用来判断"拖拽落位后顺序有没有真的变化"，没变化就不用
 * 发 PATCH /reorder）。
 */
export function isSameOrder<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}
