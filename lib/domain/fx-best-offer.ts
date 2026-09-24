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

/**
 * fx-compare-card.tsx 专用（第六十五轮，Remy 明确要求）：「✓最划算」徽章只在
 * 「我的支付方式」（kind==='card'）内部比较，不跟「渠道换汇」（kind==='channel'）
 * 参考价掺在一起比——渠道那组数字是固定点差表估算的参考值，不是 Remy 手上真有的
 * 付款方式，拿渠道去跟她真实的卡比"划算"没有意义。
 *
 * 传入完整的、已经按 effectiveRate 全局排好序、带 `globalIndex` 的混合行列表
 * （channel+card），这里先按 `kind` 过滤出卡片子集，在这个子集里复用
 * `findBestOfferIndex` 同一套资格判断（跳过 unavailable/同币种不需要换汇的行），
 * 再把子集内的下标换算回原始的 `globalIndex`（不是子集自己的下标）返回，调用方
 * 直接 `row.globalIndex === 返回值` 判断要不要显示徽章——channel 行的 globalIndex
 * 永远不可能等于一个来自 card 子集的值，天然不会命中。一张卡都没有资格（包括
 * 完全没有卡）时返回 -1，跟 `findBestOfferIndex` 的"找不到"语义一致。
 */
export function findBestCardOfferGlobalIndex<
  T extends BestOfferCandidate & { kind: 'channel' | 'card'; globalIndex: number },
>(rows: T[]): number {
  const cardRows = rows.filter((r) => r.kind === 'card');
  const posWithinCards = findBestOfferIndex(cardRows);
  return posWithinCards >= 0 ? cardRows[posWithinCards]!.globalIndex : -1;
}
