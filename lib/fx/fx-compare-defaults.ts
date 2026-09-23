/**
 * 纯函数、零依赖——`app/trips/[tripId]/fx-compare-card.tsx`（汇率比价卡片）
 * 「我持有」「目标币种」两个下拉的候选清单 + 默认值推导逻辑，从组件里拆出来
 * 单独测试，不用挂 React Testing Library 去点开下拉才能验证这几条规则。
 *
 * 2026-09-23 真实 bug 修复背景（第一次）：目标币种的初始默认值原本在组件里硬
 * 编码字面量 'THB'，从来没有跟着 trip 的 baseCurrency/enabledCurrencies 联动过
 * （最早在"2026曼谷"泰铢语境下开发时顺手写死，合并组件那几轮都没人把它改成动态
 * 推导）。Remy 在本位币 HKD 的"🇭🇰2026香港"行程上反馈"为何强制显示 THB"，真实
 * D1 数据核实过这趟行程 enabledCurrencies=[MYR,HKD,USD,CNY]，从头到尾没有 THB。
 * `resolveDefaultTarget` 改成优先从这趟行程真实启用的币种里挑，兜底才退回固定
 * 候选表第一项（这条兜底路径专门保留给 enabledCurrencies 为 null 的旧行程，
 * 比如"2026曼谷"本身继续默认 THB 不受影响——默认泰铢对一趟泰国行程没有错，
 * 这次要修的是"默认值没有服务于当前这趟行程"，不是要把 THB 判死刑）。
 *
 * 2026-09-23 真实 bug 修复背景（第二次，Remy 反馈"目标币种下拉选项太少"）：
 * 真机核对下来 Remy 大概率点开的其实是"我持有"下拉（这轮把两个下拉都一起扩了，
 * 不只是她点开的那一个）。根因是两层过滤叠加：①旧的 `HOLD_CURRENCY_CANDIDATES`
 * 只有 4 项（MYR/USD/HKD/CNY），比"目标币种"的 5 项还窄；②`resolveHoldCandidates`
 * 还会再拿这趟行程的 `enabledCurrencies` 做一次交集收窄（这趟行程正好是
 * [MYR,HKD,USD,CNY]，交集没有进一步收窄，但下拉本身还要再排除掉当前"目标币种"
 * 选中的那个——默认目标是 USD，所以最终只剩 MYR/HKD/CNY 三个）。这套"用
 * enabledCurrencies 收窄可选范围"的设计还有一个更深的问题：这趟行程创建之后
 * `enabledCurrencies` 完全没有编辑入口（只有新建行程那一步能设置），等于把
 * "我持有能选什么"焊死在开行程那一刻的选择上，Remy 之后想多看一种货币的比价
 * 完全没有办法自己打开——不是"数据不够"，是"入口被焊死"。
 *
 * 这次的修法：
 * 1. 候选池从 `lib/fx/fetch-rates.ts` 的 `FX_NEEDED_QUOTE_CURRENCIES`（这几个
 *    币种本来就已经在拉实时汇率，只是"我持有"下拉一直没把它们全部暴露出来）
 *    整份接进来，"我持有"= 候选池 + MYR 自己（本位币兜底一直存在，不能丢）；
 *    "目标币种"= 候选池本身，不含 MYR——保留原设计的语义（MYR 是"随身带出门的
 *    本币"，不该同时又是"想换成什么"的目的地，这条不是这次改的重点，维持现状）。
 * 2. "我持有"不再用 `enabledCurrencies` 收窄可选范围（见上面"入口被焊死"那段），
 *    改成两个下拉各自只互斥对方当前选中的那个币种，别的全部可选。
 * 3. `enabledCurrencies` 从"限制能选什么"降级成"决定默认选哪个"——
 *    `resolveDefaultTarget` 逻辑不变（优先选这趟行程真实启用的币种），这样默认
 *    值依然贴合这趟行程，只是不再限制用户之后自己想多看别的币种。
 */

// 跟 `lib/fx/fetch-rates.ts` 的 `FX_NEEDED_QUOTE_CURRENCIES` 逐一对应（这几个
// 币种已经在拉实时汇率，只是之前没有全部暴露成下拉选项）——顺序刻意保留
// THB 在最前面，是这个项目从"2026曼谷"起家时就有的默认目标币种语境，扩容
// 候选池不能意外把老行程的默认值顶替掉（`resolveDefaultTarget` 兜底那行会用到）。
export const FX_SUPPORTED_CURRENCIES = ['THB', 'USD', 'SGD', 'CNY', 'HKD', 'PHP', 'LKR'] as const;

// "目标币种"候选就是完整候选池本身，不含 MYR（维持"本币不该是换汇目的地"这条
// 既有语义，这次没有改）。
export const TARGET_CURRENCY_CANDIDATES = FX_SUPPORTED_CURRENCIES;

// "我持有"候选 = 完整候选池 + MYR（本位币兜底）——这次修复前只有 4 项
// （MYR/USD/HKD/CNY），现在跟目标币种共用同一份底层数据支持，扩到 8 项。
export const HOLD_CURRENCY_CANDIDATES = ['MYR', ...FX_SUPPORTED_CURRENCIES] as const;

// "我持有"不再用 enabledCurrencies 收窄可选范围（2026-09-23 第二次修复，见文件
// 顶部大注释）——直接给出完整候选池，两个下拉各自在 fx-compare-card.tsx 里再
// `.filter` 掉当前对方选中的值就够了。参数保留不删，避免改动调用方签名；这趟
// 参数目前真正用得到的地方只剩 `resolveDefaultTarget`。
export function resolveHoldCandidates(_enabledCurrencies: string[] | null): string[] {
  return [...HOLD_CURRENCY_CANDIDATES];
}

export function resolveTargetCandidates(hold: string): string[] {
  return TARGET_CURRENCY_CANDIDATES.filter((c) => c !== hold);
}

/**
 * 目标币种默认值：优先选这趟行程 enabledCurrencies 里、且合法（在 hold 排除后的
 * 候选表里）的第一个币种；enabledCurrencies 为空/查不到合法交集时，优先退回 THB
 * （这个 app 最早的默认目标币种语境，候选池扩容不能意外顶替掉老行程的默认值），
 * 候选表里连 THB 都没有（比如 hold 本身就是 THB）才再退到候选表第一项。
 */
export function resolveDefaultTarget(hold: string, enabledCurrencies: string[] | null): string {
  const candidates = resolveTargetCandidates(hold);
  if (enabledCurrencies && enabledCurrencies.length > 0) {
    const relevant = candidates.filter((c) => enabledCurrencies.includes(c));
    if (relevant[0] !== undefined) return relevant[0];
  }
  if (candidates.includes('THB')) return 'THB';
  return candidates[0] ?? 'THB';
}
