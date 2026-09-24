/**
 * 汇率比价卡「记住这组选项」存档的内容比对——round66 根治"零交互也 PUT"这轮新增。
 *
 * 背景：round64/65 发现汇率比价卡只要打开行程主页就会 PUT 一次 `fx-compare-preference`，
 * 哪怕用户完全没碰任何输入。round66 用本地真实浏览器 + 时间戳实测坐实了根因（详见
 * `fx-compare-card.tsx` 那两个 effect 的注释、PENDING-DECISIONS 第六十六轮）：
 * `preferenceLoadedRef`+`setTimeout(0)`这套"跳过刚恢复完存档又原样写回一次"的防抖
 * 保护，在这个项目实测的运行环境里（真实浏览器 + opennextjs-cloudflare 本地
 * Workers 运行时，不是 `next dev`）**不可靠**——`setTimeout(0)` 这个宏任务，6/6 次
 * 复现都是在 React 把"加载存档"这次 state 更新对应的被动 effect（保存 effect）跑
 * 完之前就已经触发，导致保存 effect 判断到的 `preferenceLoadedRef.current` 已经是
 * `true`，于是把刚从 D1 读回来的内容原样再 PUT 回去一次——不是偶发 race，是这个环境
 * 下稳定复现的时序结论。
 *
 * 根治方案是两层：①（主要修复）把"要不要保存"的判断从"计时器有没有跑完"这种脆弱的
 * JS 调度时序，换成"用户是不是真的手动改过某个输入"这个显式、确定性的信号——`fx-compare-
 * card.tsx` 里新增 `hasUserInteractedRef`，只在四个真实操作入口（我持有下拉/目标币种
 * 下拉/自选比较项勾选/兑换金额输入框）里置 true，组件挂载、载入已存档偏好、"新卡默认
 * 勾选"这类派生计算完全不会碰这个 ref。②（双保险，这个文件的职责）即使上面那层哪里
 * 没堵干净，发起 PUT 前先跟"已知最新存档内容"比一遍，内容完全相同就不发请求——不比较
 * JSON 字符串/数组顺序（`enabledCompareKeys` 存的是 Set 转来的数组，同样的内容不同
 * 插入顺序会序列化成不同字符串，但语义上是同一份偏好，必须按集合比较，不能按顺序比较，
 * 不然这层双保险本身就会被"顺序不同"误判成"内容变了"而失效）。
 */

export interface FxComparePreferenceSnapshot {
  holdCurrency: string;
  targetCurrency: string;
  enabledCompareKeys: readonly string[];
  amountYuan: number;
}

/**
 * 两份存档内容是否等价（用于"要不要真的发一次 PUT"的判断）。
 * - `null` 代表"还没有任何存档"，只有两边都是 `null` 才算相同（比如从没保存过、
 *   这次也还没触发过真正的写入）；一边 null 一边有值一定是"变了"，必须放行写入
 *   （否则用户第一次真实操作产生的第一份存档永远发不出去）。
 * - `enabledCompareKeys` 按集合（不看顺序、不看重复）比较，其余三个字段按值比较。
 */
export function isSameFxComparePreference(
  a: FxComparePreferenceSnapshot | null,
  b: FxComparePreferenceSnapshot | null
): boolean {
  if (a === null || b === null) return a === b;
  if (a.holdCurrency !== b.holdCurrency) return false;
  if (a.targetCurrency !== b.targetCurrency) return false;
  if (a.amountYuan !== b.amountYuan) return false;

  const setA = new Set(a.enabledCompareKeys);
  const setB = new Set(b.enabledCompareKeys);
  if (setA.size !== setB.size) return false;
  for (const key of setA) {
    if (!setB.has(key)) return false;
  }
  return true;
}
