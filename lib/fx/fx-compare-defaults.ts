/**
 * 纯函数、零依赖——`app/trips/[tripId]/fx-compare-card.tsx`（汇率比价卡片）
 * 「我持有」「目标币种」两个下拉的候选清单 + 默认值推导逻辑，从组件里拆出来
 * 单独测试，不用挂 React Testing Library 去点开下拉才能验证这几条规则。
 *
 * 2026-09-23 真实 bug 修复背景：目标币种的初始默认值原本在组件里硬编码字面量
 * 'THB'，从来没有跟着 trip 的 baseCurrency/enabledCurrencies 联动过（最早在
 * "2026曼谷"泰铢语境下开发时顺手写死，合并组件那几轮都没人把它改成动态推导）。
 * Remy 在本位币 HKD 的"🇭🇰2026香港"行程上反馈"为何强制显示 THB"，真实 D1
 * 数据核实过这趟行程 enabledCurrencies=[MYR,HKD,USD,CNY]，从头到尾没有 THB。
 * `resolveDefaultTarget` 改成优先从这趟行程真实启用的币种里挑，兜底才退回固定
 * 候选表第一项（这条兜底路径专门保留给 enabledCurrencies 为 null 的旧行程，
 * 比如"2026曼谷"本身继续默认 THB 不受影响——默认泰铢对一趟泰国行程没有错，
 * 这次要修的是"默认值没有服务于当前这趟行程"，不是要把 THB 判死刑）。
 */

// 目标币种候选必须是 Artifact 写死的固定 5 项，跟"我持有"选了哪个币种无关——
// 2026-09-17 第二十轮真机截图坐实的回归教训见 fx-compare-card.tsx 顶部大注释，
// 这里原样保留同一份字面量，不从任何汇率数据表的 key 集合反推。
export const TARGET_CURRENCY_CANDIDATES = ['THB', 'USD', 'SGD', 'CNY', 'HKD'] as const;

// "我持有"候选清单同样是产品需求决定的固定基准集合（这几个基准在
// `FX_RATES_FALLBACK`/实时汇率表里都能查到换算），不是任意币种都能选。
export const HOLD_CURRENCY_CANDIDATES = ['MYR', 'USD', 'HKD', 'CNY'] as const;

export function resolveHoldCandidates(enabledCurrencies: string[] | null): string[] {
  const allHolds: string[] = [...HOLD_CURRENCY_CANDIDATES];
  if (!enabledCurrencies || enabledCurrencies.length === 0) return allHolds;
  return allHolds.filter((h) => enabledCurrencies.includes(h));
}

export function resolveTargetCandidates(hold: string): string[] {
  return TARGET_CURRENCY_CANDIDATES.filter((c) => c !== hold);
}

/**
 * 目标币种默认值：优先选这趟行程 enabledCurrencies 里、且合法（在 hold 排除后的
 * 候选表里）的第一个币种；enabledCurrencies 为空/查不到合法交集才退回固定候选
 * 表第一项。
 */
export function resolveDefaultTarget(hold: string, enabledCurrencies: string[] | null): string {
  const candidates = resolveTargetCandidates(hold);
  if (enabledCurrencies && enabledCurrencies.length > 0) {
    const relevant = candidates.filter((c) => enabledCurrencies.includes(c));
    if (relevant[0] !== undefined) return relevant[0];
  }
  return candidates[0] ?? 'THB';
}
