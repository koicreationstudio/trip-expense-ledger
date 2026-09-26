import { yuanToCents } from '@/lib/money';

/**
 * 活动流（expense-list.tsx）「金额」筛选 chip 的纯函数。这个 chip 跟其它 4 个
 * 筛选 chip（排序/分类/垫付人/日期/支付方式）不一样——不是从候选清单里选一个
 * 字符串，是数值区间/等值比较，套不进 SelectDropdown 的 value/onChange 单选
 * 模型，单独抽成这份纯函数，方便脱离组件单测。
 *
 * 参与比较的数字统一用"分"为单位的整数（跟 lib/money.ts 全站约定一致，避免
 * 浮点误差）：
 * - `amountCents`：这笔消费原始记账金额（原币种，对应 ExpenseListItem.amount）。
 * - `convertedCents`：这笔消费换算成"这个用户熟悉的那个基准货币"的参考值——
 *   调用方传 ExpenseListItem.amountMyr（行程本位币不是 MYR 时）或
 *   ExpenseListItem.amountBaseCurrency（本位币是 MYR 时），"该用哪一个"这层
 *   判断留在 expense-list.tsx 里做（跟现有 `showConverted` 那段判断共用同一条
 *   件，不在这里重复判断一次）——这个文件不关心行程配置，只认调用方已经算好
 *   传进来的这两个数字。传 `null` 代表这一刻没有可比的换算值（汇率缓存暂时不
 *   可用），区间模式下没有可比数字就没法判断落不落在区间内，保守排除（不显示，
 *   不是猜测性地当作命中）；精确模式下退化成只看原始金额那一路是否命中。
 */

export type AmountFilterMode = 'range' | 'exact';

export interface AmountFilterableExpense {
  amountCents: number;
  convertedCents: number | null;
}

export interface AmountRangeFilter {
  /** null = 不限最低（用户没填"最低"输入框）。 */
  minCents: number | null;
  /** null = 不限最高（用户没填"最高"输入框）。 */
  maxCents: number | null;
}

/**
 * 区间模式：`convertedCents` 落在 [minCents, maxCents] 闭区间内才算命中——
 * 用闭区间（<=/>=）而不是开区间，用户填"最低 50"是期望正好 50 也算进来，不是
 * 严格大于 50 才算。min/max 都是 null（两个输入框都没填）视为"没开这个筛选"，
 * 全部放行，跟其它筛选 chip 的 ALL 语义一致。
 */
export function matchesAmountRange(expense: AmountFilterableExpense, range: AmountRangeFilter): boolean {
  if (range.minCents === null && range.maxCents === null) return true;
  if (expense.convertedCents === null) return false;
  if (range.minCents !== null && expense.convertedCents < range.minCents) return false;
  if (range.maxCents !== null && expense.convertedCents > range.maxCents) return false;
  return true;
}

/**
 * 精确模式：原始记账金额或换算参考值，任一等于用户填的目标金额就算命中——
 * 填原币金额、或填折算后大概看到的那个数字，两种输入习惯都能命中同一笔消费。
 */
export function matchesAmountExact(expense: AmountFilterableExpense, targetCents: number): boolean {
  if (expense.amountCents === targetCents) return true;
  if (expense.convertedCents !== null && expense.convertedCents === targetCents) return true;
  return false;
}

/**
 * 把用户在筛选输入框里打的"元"字符串转成"分"整数，供上面两个函数使用——
 * 复用 `lib/money.ts` 的 `yuanToCents`（Math.round 四舍五入），不新发明一套
 * 舍入规则，跟全站记账表单同一套换算行为，包括它已知的浮点边界情况（比如
 * 1.005 这种十进制小数在 IEEE754 下本来就没有精确表示，`1.005*100` 算出来是
 * `100.49999999999999`，`Math.round` 会取整成 100 分=1.00 元而不是"看起来该
 * 四舍五入到"的 1.01 元——这不是这个函数的 bug，是继承自 `yuanToCents`/JS
 * 浮点数本身的性质，全站记账表单一直是这个行为，这里保持一致不单独修）。
 * 空字符串/纯空白/无法解析成有效数字，返回 `null`（代表"这个输入框还没填"），
 * 不是 0——0 是一个合法的筛选目标金额，不能跟"没填"混用同一个值。
 */
export function parseAmountYuanInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return yuanToCents(parsed);
}
