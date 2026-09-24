/**
 * 「✓最划算」徽章该落在哪一行——2026-09-24 第五十八轮，Remy 真实反馈：现金 USD
 * 付一笔 USD 计价的消费不需要经过任何换汇，这是 1:1 无损，跟其它要经过汇率折算
 * 的方式不是同一个可比性质，不应该被判定为"最划算"参与排序竞争（哪怕它数字上
 * 最小/汇率上最优）。
 *
 * 这个 chokepoint 被两处调用：`fx-compare-list.tsx`（"记一笔消费"表单的支付方式
 * 选择器，按 costInCompareCurrency 升序排好）跟 `fx-compare-card.tsx`（汇率比价
 * 卡片的 allRows，按 effectiveRate 降序排好）——两处排序方向不同，但"排好序后找
 * 第一个真正有资格拿徽章的行"这条规则是同一条：跳过不可用的行，也跳过同币种无需
 * 换汇的行。抽成这一个函数，避免两处各自实现一遍、以后改判定条件只改一处、两边
 * 同时生效，不会漂移。
 *
 * 只负责"在已经排好序的数组里找第一个符合资格的下标"，不做排序——排序方向、排序
 * 依据由调用方各自决定，这里不管。
 */
export interface BestOfferCandidate {
  /** 汇率/成本缺失、这一行本来就不该参与排序竞争时为 true。没有这个字段的调用方视为 false。 */
  unavailable?: boolean;
  /** false = 同币种，不需要经过任何换汇（1:1 无损），不该跟真正经过折算的方式抢"最划算"。 */
  requiresConversion: boolean;
}

/**
 * 返回第一个「不可用为 false 且 requiresConversion 为 true」的行的下标；一个都
 * 没有（比如所有行都是同币种，或者全部不可用）时返回 -1——调用方直接用
 * `index === firstEligibleIndex` 判断是否显示徽章，-1 天然不会命中任何真实下标，
 * 不需要额外判空。
 */
export function findBestOfferIndex<T extends BestOfferCandidate>(rows: T[]): number {
  return rows.findIndex((r) => !r.unavailable && r.requiresConversion);
}
