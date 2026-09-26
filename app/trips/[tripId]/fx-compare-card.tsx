'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { yuanToCents, centsToYuan } from '@/lib/money';
import { DEFAULT_CASH_EXCHANGE_MARKUP_PERCENT, type FxRecommendationResult } from '@/lib/domain/fx-recommendation';
import { deriveMidRate } from '@/lib/fx/derive-mid-rate';
import { resolveHoldCandidates, resolveTargetCandidates, resolveDefaultTarget } from '@/lib/fx/fx-compare-defaults';
import { SelectDropdown, useDismissableOpen } from '@/components/select-dropdown';
import { Switch } from '@/components/switch';
import { findBestOfferIndex } from '@/lib/domain/fx-best-offer';
import { isSameFxComparePreference, type FxComparePreferenceSnapshot } from '@/lib/domain/fx-compare-preference-diff';
import { quickBaseGridClassName } from '@/lib/domain/quick-base-grid';
import {
  formatThousands,
  stripThousands,
  countMeaningfulCharsBefore,
  positionForMeaningfulCount,
} from '@/lib/format-thousands';

/**
 * 汇率比价——2026-09-16 第十八轮，Remy 拍板"要根治"：把原本两张独立卡片
 * （fx-rate-card.tsx「当前汇率比价」+ fx-channel-compare-card.tsx「换汇渠道比价」）
 * 合并成 Artifact V10 那种"目标币种下拉 + 自选渠道"单卡结构，两边原有的查询能力
 * 都要保留，不能为了凑外观拆掉功能。这个文件替掉了那两个文件。
 *
 * === 这两个功能本来在回答两个不同的问题，合并前先想清楚怎么共用一套输入 ===
 *
 * 「当前汇率比价」原本回答的问题："这笔钱要花在 {目标币种}，用我配置的哪张卡/
 * 现金结账最划算？" —— 调用 /api/trips/{tripId}/fx-recommendation，吃的是
 * Remy 自己在「支付方式」页配置的每张卡的汇率加点/境外手续费/固定费/返现，
 * 汇率来源是服务器端 exchange_rate_cache（open.er-api.com 抓的实时汇率，
 * 24 小时刷新一次），结果用 trip.baseCurrency 统一算成"这笔消费换算成本位币
 * 要花多少钱"，数字是准的。
 *
 * 「换汇渠道比价」原本回答的问题："我手上拿着 {我持有的币种}，要换成
 * {目标币种}现金，走 Wise/TNG跨境/ATM取款/换钱店/支付宝 哪个渠道换到的更多？"
 * ——纯前端算，吃的是 FX_CHANNELS 这张写死的点差表（部分数字是 Remy 自己都承认
 * 的粗略估算，不是接口现查），"我持有"只能选 MYR 或 USD（FX_RATES 只有这两个
 * 基准）。
 *
 * 这两组数字的"分母"不一样：前者是"花掉多少本位币"，后者是"手上的钱换成多少
 * 目标币种"，直接混进同一个排序列表会变成拿准确数字跟粗略估算数字比大小，
 * 容易让人误以为两者精度一样。这次合并采用的解法：
 * 1. 「我持有」这个基准跟"要不要顺便看我自己的卡"绑在一起——只有当"我持有"
 *    选的正好是**这趟行程的本位币**（trip.baseCurrency）时，才会把"我的支付
 *    方式"也列进同一张比价清单；选别的持有币种（比如 MYR/USD，这趟行程本身
 *    不是拿这两个当本位币）时，只显示渠道比价，不显示我的卡——因为"我的卡"这
 *    组数字本来就是按"花本位币买目标币种东西"算的，脱离本位币语境比较没有意义，
 *    不该硬凑数字进同一个列表制造虚假精度。
 * 2. 「我的支付方式」这行的排序位置：用 API 返回的 costInCompareCurrency（花
 *    notionalTargetAmount 的目标币种要花多少本位币）反推出"1 单位本位币能换到
 *    多少目标币种"这个隐含汇率（`notionalTargetAmount / costInCompareCurrency`），
 *    这样就能跟渠道那边"1 单位本位币换到多少目标币种"的 effectiveRate 用同一个
 *    方向、同一套排序规则比大小——数字来源不同（一个准一个估）但比较的量纲一致，
 *    不是各算各的拼凑到一起。
 * 3. FX_RATES 这张静态表原来只有 MYR/USD 两个基准，香港行程（本位币 HKD）会被迫
 *    退回 MYR 当基准，选不到"我持有 HKD"——这次补上 HKD 作为第三个基准（用现成
 *    的 MYR→HKD=1.92 反推 1 HKD≈0.5208 MYR，再用 MYR 那行的其它汇率换算出来，
 *    数量级来源可追溯，不是瞎编），这样香港行程默认就能同时看到渠道比价 + 卡比价。
 * 4. fix(2026-09-17 第二十一轮，功能性QA坐实的真bug)：这条真实行程 enabled_currencies
 *    明确包含 CNY，但"我持有"候选池 `resolveHoldCandidates` 读的是 `Object.keys(FX_RATES)`
 *    ——CNY 从来不是这张表的"基准"（只在 MYR/USD/HKD 三行里当"目标"出现过），导致
 *    "我持有"永远选不到 CNY，即使这趟行程明明启用了它，跟"目标币种"那边能选 CNY
 *    不对称。这次补上 CNY 作为第四个基准，用同一套方法（从 MYR 那行反推，数量级
 *    可追溯）：1 CNY = 1/1.61 MYR ≈ 0.6211 MYR，再用 MYR 那行其它汇率换算出
 *    THB/USD/SGD/HKD，不是凭空编的新数字。
 * 5. fix(2026-09-17 第二十二轮，Remy 明确要求)："渠道比价"这组数字之前一直是这个
 *    文件里手写死的 `FX_RATES` 静态表（连注释都写着"数量级可追溯，不是瞎编"，
 *    但终究还是写死的数字，不会跟着真实汇率波动）。这轮改成真的接实时汇率：
 *    新增 `GET /api/trips/{tripId}/fx-mid-rates`，跟"我的支付方式"那组一样吃
 *    `exchange_rate_cache`（`lib/fx/rate-cache.ts` 共享模块，24 小时刷新一次，
 *    源头同样是 open.er-api.com），区别是这个端点不要求配置过支付方式——渠道
 *    比价的中间汇率跟"有没有配卡"这件事无关。原来的 `FX_RATES` 表降级成
 *    `FX_RATES_FALLBACK`，只在实时抓取失败/还没抓到的短暂窗口内顶一下，界面
 *    上会明确标注"离线参考汇率"，不会悄悄拿旧数字冒充实时数据。各渠道最终
 *    展示的汇率 = 实时中间价 × (1 + 该渠道固定点差/手续费百分比)——点差/手续费
 *    这些百分比本身还是参考值（不是接口现查，这个没有变），变的只是"中间价"
 *    这一个数字的来源。
 * 6. fix(2026-09-23 第三十三轮，Remy 报真 bug C+D，方案二拍板)：之前"渠道比价"
 *    （5个固定渠道，`enabledChannelKeys` 过滤）和"我的支付方式"（真实卡片，
 *    `includeMyCards` 一个总开关控制要不要显示整组）是两套完全独立的过滤 state，
 *    列表渲染时把两组结果直接拼在一起、毫无视觉区分——用户取消勾选"⚙自选渠道"
 *    里的某几项，列表里同名的"我的支付方式"那几行完全不受影响，看起来像是过滤
 *    没生效（这就是 D），而且两组都可能出现同名渠道（比如都叫"Wise"）却没有
 *    来源标签区分（这就是 C）。Remy 拍板选方案二：把两组过滤开关合并成一套
 *    `enabledCompareKeys`，`channel:<key>`/`card:<paymentMethodId>` 统一命名空间，
 *    取消勾选任何一项（不管是固定渠道还是真实卡片）立刻从下面列表消失，每行
 *    保留一个来源徽章（渠道/我的方式）。"我的支付方式"是异步从服务器拉的，
 *    合并进同一张勾选清单要处理两件事：①卡片列表还没拉回来之前，dropdown 里
 *    显示"加载中…"占位而不是空的勾选框（不能让用户勾选到还不存在的东西）；
 *    ②卡片拉回来的那一刻要把新出现的卡默认勾选上（不然用户还没见过这张卡，
 *    它却已经被排除在外），用 `initializedCardKeysRef` 记录"这张卡是不是已经
 *    出现过、需不需要再次自动勾选"，避免每次 `forceRefresh` 重新拉取时把用户
 *    手动取消勾选过的卡又强制勾回来。旧的 `includeMyCards` 总开关退休，"我的
 *    支付方式要不要出现在比较范围里"这个能力完全下放给每张卡各自的勾选框；
 *    是否具备"可以比较我的卡"这个资格（`showCards`）继续只看"是否配置过支付
 *    方式 + 我持有是否等于行程本位币"这两条业务规则，跟自选比较项过滤是两回事，
 *    不要混在一起判断。
 * 7. fix(2026-09-23 第三十七轮，Remy 报真 bug"目标币种下拉选项太少")：真机核对
 *    下来 Remy 大概率点开的其实是"我持有"下拉——旧的 `HOLD_CURRENCY_CANDIDATES`
 *    只有 4 项（MYR/USD/HKD/CNY），且还会被这趟行程的 `enabledCurrencies` 再收窄
 *    一次、下拉本身又要排除掉当前"目标币种"选中的那个，三层叠加导致真实行程上
 *    最终只剩 3 项。`enabledCurrencies` 这趟行程创建之后完全没有编辑入口，等于
 *    把"我持有能选什么"焊死在开行程那一刻——这次把"我持有"/"目标币种"两个下拉
 *    的候选池统一改成读 `lib/fx/fx-compare-defaults.ts` 的 `FX_SUPPORTED_
 *    CURRENCIES`（跟 `lib/fx/fetch-rates.ts` 已经在拉实时汇率的 7 个币种逐一
 *    对应，外加 MYR 自己），`enabledCurrencies` 降级成只决定默认选哪个，不再
 *    限制能选什么。离线兜底表 `FX_RATES_FALLBACK` 跟着补齐 THB/SGD/PHP/LKR
 *    四个新增基准行 + 给已有行补上 PHP/LKR 两列，PHP/LKR 的数值是拿 open.er-api
 *    同源的 USD 基准换算（1 USD≈62.76 PHP、1 USD≈329.13 LKR，2026-09-23 查证），
 *    再用这张表已有的 USD→其它币种汇率交叉推算出来的，不是凭空编的。
 * 8. fix(2026-09-26 第七十一轮，任务③，Remy 明确要求"我持有≠本位币也要列出我的
 *    支付方式")：推翻上面第 1 点"只有我持有===本位币才显示我的支付方式"这条规则。
 *    现在只要 `hasPaymentMethods` 为真就有资格显示这组卡，具体列哪几张卡改成用
 *    `settlementCurrency === effectiveHold` 筛（不是任意场景都可比，是"结算币种
 *    刚好是我此刻持有的这个币种"的那几张卡）。数学前提：`/api/trips/{tripId}/
 *    fx-recommendation` 现在显式传 `compareCurrency: effectiveHold`（不再依赖
 *    服务器端默认退回 trip.baseCurrency），`impliedRate = 目标币种金额 / 成本`
 *    这个隐含汇率公式只有在 compareCurrency===我持有 时数学上才成立——这次改动
 *    从"隐式刚好相等（因为两个都固定等于本位币）"变成"显式传我持有"，公式前提
 *    没有被破坏，只是覆盖范围从"我持有必须是本位币"放宽到"我持有可以是任意
 *    支持的币种"。"✓最划算"徽章也从第 65 轮"只在我的支付方式内部比"改回跨
 *    当前可见的全部行比较（渠道+卡，只要是用户此刻真的看得到的行），见下面
 *    `findBestOfferIndex`/`visibleForBestOffer` 的用法。
 */

// fix(2026-09-17 第二十二轮)：这张表从"唯一数据来源"降级成"实时汇率抓不到时的
// 离线兜底"——正常情况下页面用的是 `/api/trips/{tripId}/fx-mid-rates` 现抓的
// 实时汇率，这张表只在 API 失败/加载中的短暂窗口顶一下，界面上会标"离线参考汇率"。
// fix(2026-09-23 第三十七轮)：补齐 THB/SGD/PHP/LKR 四个新增基准行（候选池从 4
// 扩到 8，见上面大注释第 7 点），所有新数值都是从这张表已有的 MYR/USD 基准
// 交叉换算出来的，来源可追溯，不是瞎编。
const FX_RATES_FALLBACK: Record<string, Record<string, number>> = {
  MYR: { THB: 8.12, USD: 0.245, SGD: 0.318, CNY: 1.61, HKD: 1.92, PHP: 15.38, LKR: 80.67 },
  USD: { THB: 33.03, MYR: 4.08, SGD: 1.3, CNY: 6.58, HKD: 7.82, PHP: 62.76, LKR: 329.13 },
  HKD: { THB: 4.229, USD: 0.1276, SGD: 0.1656, CNY: 0.8385, MYR: 0.5208, PHP: 8.011, LKR: 42.01 },
  CNY: { THB: 5.044, USD: 0.1522, SGD: 0.1975, HKD: 1.1926, MYR: 0.6211, PHP: 9.554, LKR: 50.10 },
  THB: { USD: 0.0302, MYR: 0.1232, SGD: 0.0392, CNY: 0.1983, HKD: 0.2365, PHP: 1.894, LKR: 9.935 },
  SGD: { USD: 0.7707, MYR: 3.1447, THB: 25.53, CNY: 5.063, HKD: 6.038, PHP: 48.37, LKR: 253.7 },
  PHP: { USD: 0.01594, MYR: 0.06502, THB: 0.5279, SGD: 0.02067, CNY: 0.1047, HKD: 0.1248, LKR: 5.244 },
  LKR: { USD: 0.003038, MYR: 0.01240, THB: 0.1007, SGD: 0.003942, CNY: 0.01996, HKD: 0.02380, PHP: 0.1907 },
};

const FX_SYMBOLS: Record<string, string> = {
  THB: '฿',
  USD: '$',
  SGD: 'S$',
  CNY: '¥',
  HKD: 'HK$',
  MYR: 'RM',
  PHP: '₱',
  LKR: 'Rs',
};

// fix(2026-09-23 第三十七轮)："我持有"下拉候选池从 4 扩到 8（见上面大注释第 7 点），
// 但下面"基准换算卡片"这一排是纯展示性的快速参考卡，Artifact 原意只是"补两张
// 基准卡"（round7 第 3 点原话），不是要跟着下拉选项数量一起涨到 8 张挤爆这一排。
// 这里刻意保留原本 4 个最常用的基准（不是意外遗漏，是有意跟下拉候选池解耦），
// 下拉本身该有多少个选项是另一件事，不受这张表长度限制。
const QUICK_BASE_CARD_CURRENCIES = ['MYR', 'USD', 'HKD', 'CNY'] as const;

const TARGET_CURRENCY_LABELS: Record<string, string> = {
  THB: 'THB 泰铢',
  USD: 'USD 美金',
  SGD: 'SGD 新币',
  CNY: 'CNY 人民币',
  HKD: 'HKD 港币',
  MYR: 'MYR 令吉',
  PHP: 'PHP 比索',
  LKR: 'LKR 卢比',
};

interface StaticChannel {
  key: string;
  name: string;
  spread: number;
  note: string;
  isAlipay?: boolean;
}

const STATIC_CHANNELS: StaticChannel[] = [
  { key: 'wise', name: 'Wise', spread: -0.00714, note: '接近中间价 · 约 0.7% 手续费' },
  { key: 'tng', name: 'TNG 跨境', spread: -0.01515, note: 'DuitNow 跨境 · 约 -1.5%' },
  { key: 'atm', name: 'ATM 取款', spread: -0.02217, note: '银行外汇费约 2% + ฿220 固定手续费' },
  { key: 'moneychanger', name: '换钱店', spread: -DEFAULT_CASH_EXCHANGE_MARKUP_PERCENT / 100, note: '市区 Superrich · 约 -2.5%，机场更差' },
  {
    key: 'alipay',
    name: '支付宝',
    spread: -0.018,
    note: '约 -1.8%（估算值，待真实数据更新）',
    isAlipay: true,
  },
];

// fix(2026-09-17 第二十二轮)：这个固定手续费（220 THB 等值）的换算原来死绑
// `FX_RATES.MYR`，现在改吃调用方传进来的"当前生效的 MYR 基准汇率表"（实时优先，
// 抓不到才是离线表），这样 ATM 这一行的手续费文案也会跟着实时汇率变，不再是
// 用一份写死数字算出来的固定文案。
function formatAtmFeeNote(targetCurrency: string, myrRates: Record<string, number>): string {
  const thbPerMyr = myrRates.THB;
  const targetPerMyr = targetCurrency === 'MYR' ? 1 : myrRates[targetCurrency];
  if (thbPerMyr === undefined || targetPerMyr === undefined) {
    return 'ATM 取款：银行外汇费约 2% + 固定手续费';
  }
  const feeInTarget = (220 * targetPerMyr) / thbPerMyr;
  const rounded = feeInTarget >= 100 ? Math.round(feeInTarget) : Math.round(feeInTarget * 10) / 10;
  const symbol = FX_SYMBOLS[targetCurrency] ?? '';
  return `银行外汇费约 2% + ${symbol}${rounded} 固定手续费`;
}

// fix(2026-09-23，Remy 真实反馈"我主币种是 HKD，为何强制显示 THB"，真 bug)：
// "我持有"/"目标币种"候选清单 + 目标币种默认值这三条规则，2026-09-23 起拆到
// `lib/fx/fx-compare-defaults.ts`（零依赖纯函数，跟 `lib/fx/derive-mid-rate.ts`
// 同一个理由——单独测试不用挂组件），import 在文件顶部，别再在这个文件里重新
// 定义一份，会跟 lib 那份漂移。根因/历史背景见该文件顶部注释。

/** ISO 时间戳转成"HH:MM"给脚注用，按浏览器本地时区显示（不强制转成某个固定时区）。 */
function formatFetchedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// fix(第六十六轮，Remy 报真 bug G"基准换算卡片网格排列不对称")：原来容器是
// `flex flex-wrap` + 每张卡 `flex-1`（撑满剩余空间），4 张卡挤不进一整行时，
// 换行后单独落在第二行的最后一张会被 `flex-1` 拉伸成占满整行宽度，跟上面几张
// 明显不对称。改成 CSS Grid（`quickBaseGridClassName`，拆到
// `lib/domain/quick-base-grid.ts` 方便单独写单测）——同一个 grid 的列宽由
// "总列数"决定，不受某一行实际放了几张卡影响，天然不会出现"这一行只有一张就
// 把它撑满"的问题。

interface CompareRow {
  key: string;
  label: string;
  note: string;
  kind: 'channel' | 'card';
  effectiveRate: number | null; // 目标币种/持有币种，越大越划算；null=缺数据
  amountInTarget: number | null; // 按当前金额算出的目标币种到手数（用于展示）
  // fix(2026-09-24 第五十八轮，Remy 报真 bug"同币种不该拿最划算徽章")：渠道
  // （channelRows）一定涉及换汇，恒为 true；「我的支付方式」（cardRows）这个值
  // 原样带自 FxRecommendationResult.requiresConversion（服务器已经算过，不用
  // 这里重新判断）。跟 fx-compare-list.tsx 共用同一个 `findBestOfferIndex`
  // chokepoint 判定"✓最划算"该落在哪一行。
  requiresConversion: boolean;
}

export function FxCompareCard({
  tripId,
  baseCurrency,
  hasPaymentMethods,
  enabledCurrencies,
}: {
  tripId: string;
  baseCurrency: string;
  hasPaymentMethods: boolean;
  enabledCurrencies: string[] | null;
}) {
  const [expanded, setExpanded] = useState(true);
  // fix(2026-09-24 第三十九轮)："自选比较项"是多选 checkbox 面板（渠道+我的支付方式
  // 各自可以勾多个），不是"选一个 value"这种形状，套不进 `SelectDropdown` 的 value/
  // onChange 单选模型（上面"我持有"/"目标币种"那两个已经换成调用 `SelectDropdown`
  // 本体了，这个换不了）。但"点空白/Escape 关闭"这段行为是完全通用的，改用同一个
  // `useDismissableOpen` 共用 hook（`SelectDropdown` 内部也是用这个），不再自己写
  // 第二份 `mousedown`/`keydown` 监听器。
  const [channelOpen, setChannelOpen] = useState(false);
  const channelContainerRef = useDismissableOpen(channelOpen, () => setChannelOpen(false));

  // fix(第六十五轮，Remy 明确要求)："渠道换汇"参考价这组默认收起，列表底部一行小字
  // 链接点开才展开——纯前端展示态，刻意**不**接进 fx-compare-preference 那个 D1
  // 存档（第五十七/五十八轮踩过的坑：把"这次交互随手点开了什么"也当成要长期记住
  // 的偏好写回 D1，结果污染了真实数据）。这个 state 只决定"渠道换汇"那组卡片
  // 要不要渲染，跟 `enabledCompareKeys`（真正决定"要不要参与比较/排序计算"的那组
  // 勾选状态，一直都存 D1）完全是两件事——渠道 key 就算继续勾选在 `enabledCompareKeys`
  // 里（存量真实用户数据可能还留着），这里也只是不渲染那个分组，不碰、不清空
  // 那份已存的偏好。
  const [channelGroupExpanded, setChannelGroupExpanded] = useState(false);

  const holdCandidates = resolveHoldCandidates(enabledCurrencies);
  // 默认"我持有"优先选这趟行程的本位币（这样默认就能同时看到渠道+我的卡两组数据，
  // 不用用户自己再切一次）；本位币不在支持范围内（老行程/冷门币种）才退回
  // 候选清单第一项。
  const [holdCurrency, setHoldCurrency] = useState<string>(
    holdCandidates.includes(baseCurrency) ? baseCurrency : (holdCandidates[0] ?? 'MYR')
  );
  const effectiveHold = holdCandidates.includes(holdCurrency) ? holdCurrency : (holdCandidates[0] ?? '');
  const targetCandidates = effectiveHold ? resolveTargetCandidates(effectiveHold) : [];

  const [targetCurrency, setTargetCurrency] = useState<string>(
    resolveDefaultTarget(effectiveHold, enabledCurrencies)
  );
  const effectiveTarget = targetCandidates.includes(targetCurrency) ? targetCurrency : (targetCandidates[0] ?? '');

  const [amountYuan, setAmountYuan] = useState('1000');
  // fix(第六十七轮，任务 H"兑换金额输入框加千分位")：`amountYuan` 本身继续是
  // 不带逗号的纯数字字符串（唯一真相来源，D1 payload/`amount` 派生值都不受影响），
  // 千分位纯粹是展示层的事——`<input value>` 用 `formatThousands(amountYuan)`
  // 包一层，不新增第二份 state。
  //
  // 光标定位：只有"用户刚打字"这一条路径需要重定位光标（挂载/恢复存档这些派生
  // setState 不会 focus 这个输入框，不需要）。`amountInputRef` 拿到真实 DOM 节点，
  // `pendingCursorMeaningfulCountRef` 记"这次 amountYuan 变化是不是用户刚打字
  // 触发的、需要把光标摆在第几个有意义字符（数字/小数点，逗号不算）之后"——只在
  // 下面 onChange 里设置，下面的 useLayoutEffect 消费一次就清空，不会误伤"从 D1
  // 恢复存档"这类不该重定位光标的路径。
  const amountInputRef = useRef<HTMLInputElement>(null);
  const pendingCursorMeaningfulCountRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const pendingCount = pendingCursorMeaningfulCountRef.current;
    if (pendingCount === null) return;
    pendingCursorMeaningfulCountRef.current = null;
    const input = amountInputRef.current;
    if (!input) return;
    const displayValue = formatThousands(amountYuan);
    const pos = positionForMeaningfulCount(displayValue, pendingCount);
    input.setSelectionRange(pos, pos);
  }, [amountYuan]);
  // fix(2026-09-23 第三十三轮，方案二)：统一命名空间——渠道是 `channel:<key>`，
  // 我的支付方式是 `card:<paymentMethodId>`，同一个 Set 同一套勾选/过滤逻辑，
  // 不再是"渠道用 enabledChannelKeys、我的方式用 includeMyCards 总开关"两条平行轨道。
  const [enabledCompareKeys, setEnabledCompareKeys] = useState<Set<string>>(
    new Set(STATIC_CHANNELS.map((c) => `channel:${c.key}`))
  );
  // 记录"这张卡是不是已经在 dropdown 里出现过、默认勾选过一次"——卡片列表异步到达，
  // 第一次看到某张卡时自动勾选（不能让用户第一眼就看到一张已经被排除的卡）；之后
  // 同一张卡再出现（比如点"↻刷新"重新拉取）不再重复默认勾选，尊重用户手动取消过的选择。
  const initializedCardKeysRef = useRef<Set<string>>(new Set());

  // fix(round66，根治"零交互也 PUT")：原来这里是 `preferenceLoadedRef`+`setTimeout(0)`
  // 的时序防抖保护，理论依据是"同一次 commit 的被动 effect 会在 setTimeout 宏任务
  // 之前跑完"——本地用真实浏览器 + opennextjs-cloudflare 运行时（不是 `next dev`）
  // 实测 6/6 次坐实这个假设不成立：`setTimeout(0)` 稳定地在保存 effect 跑完之前就
  // 触发，导致"刚从 D1 读回存档→setState→保存 effect"这条链路里，保存 effect 判断到
  // 的保护 ref 已经是 true，于是把刚读回来的内容原样 PUT 回去一次（round64 观察到的
  // "每进一次行程主页一次 PUT"、round65 观察到的"内容没变但 updated_at 变了"，都是
  // 这一条）。改用一个确定性的信号，不再依赖任何 JS 调度时序：`hasUserInteractedRef`
  // 只在下面四个真实操作入口（我持有下拉/目标币种下拉/自选比较项勾选/兑换金额输入框
  // 的 onChange）里置 true，组件挂载、载入已存档偏好、"新卡默认勾选"这类派生计算
  // 一律不会碰它——保存 effect 只看这个 ref，不看"存档有没有问完"。
  const hasUserInteractedRef = useRef(false);
  function markUserInteracted() {
    hasUserInteractedRef.current = true;
  }
  // fix(round66)：双保险——即使上面那层交互标记哪里没堵干净，发起 PUT 前还要跟
  // "已知最新存档内容"比一遍，内容完全相同（`enabledCompareKeys` 按集合比较，不
  // 按数组顺序，见 `lib/domain/fx-compare-preference-diff.ts`）就不发请求。这个 ref
  // 在 loadPreference 读到存档时、以及每次成功 PUT 之后更新为"当前已知的真相"。
  const lastSavedSnapshotRef = useRef<FxComparePreferenceSnapshot | null>(null);

  const [cardRecommendations, setCardRecommendations] = useState<FxRecommendationResult[] | null>(null);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [cardsError, setCardsError] = useState<string | null>(null);

  // fix(2026-09-17 第二十二轮)：渠道比价改接实时中间汇率——`liveRates` 是
  // "1 MYR = X" 形状（跟 lib/fx/rate-cache.ts 的 MyrRateSnapshot.rates 一致），
  // null 代表"还没抓到/抓失败"，这种情况下用 FX_RATES_FALLBACK 顶一下，界面上
  // 会标"离线参考汇率"，不会悄悄假装是实时数据。
  const [liveRates, setLiveRates] = useState<Record<string, number> | null>(null);
  const [liveRatesLoading, setLiveRatesLoading] = useState(false);
  const [liveRatesFetchedAt, setLiveRatesFetchedAt] = useState<string | null>(null);
  const [liveRatesFailed, setLiveRatesFailed] = useState(false);

  // fix(2026-09-23 第三十三轮，方案二)：这里只判断"有没有资格比较我的卡"，不再
  // 叠加 includeMyCards 总开关——"要不要显示某一张具体的卡"这件事下放给下面
  // enabledCompareKeys 逐卡过滤。
  // fix(2026-09-26 第七十一轮，任务③)：去掉"我持有必须等于本位币"这条门槛——
  // 只要这趟行程配置过支付方式，就有资格显示这组卡，具体哪几张卡跟"我持有"
  // 匹配由下面 cardRows 的 settlementCurrency 过滤负责，不在这里判断。
  const showCards = hasPaymentMethods;

  const fallbackMyrRates: Record<string, number> = { MYR: 1, ...FX_RATES_FALLBACK.MYR };
  const usingFallbackRates = liveRates === null;
  const activeRates = liveRates ?? fallbackMyrRates;
  const midRate = effectiveHold && effectiveTarget ? deriveMidRate(activeRates, effectiveHold, effectiveTarget) : undefined;
  const amount = Number(amountYuan) || 0;

  // fix(2026-09-24，Remy 明确要求"按账号×行程记住这组选项，换设备也要能恢复")：
  // 挂载时问一次服务器有没有存档，跟"展开/收起"卡片本身无关——收起状态下头部
  // 也要显示正确的目标币种文案（"💱 汇率比价 → {effectiveTarget}"），不能等到
  // 用户点开才去恢复。
  useEffect(() => {
    let cancelled = false;
    async function loadPreference() {
      try {
        const res = await fetch(`/api/trips/${tripId}/fx-compare-preference`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          preference: {
            holdCurrency: string;
            targetCurrency: string;
            enabledCompareKeys: string[];
            amountYuan: number;
          } | null;
        };
        const saved = data.preference;
        if (cancelled) return;
        // fix(round66)：不管有没有存档，先把"已知最新存档内容"这份真相记下来——
        // null 就是"确实还没有存档"，后面发 PUT 前的内容比对（第二层双保险）
        // 要拿这个当基准，不能让它停留在初始的 undefined/未初始化状态。
        lastSavedSnapshotRef.current = saved
          ? {
              holdCurrency: saved.holdCurrency,
              targetCurrency: saved.targetCurrency,
              enabledCompareKeys: saved.enabledCompareKeys,
              amountYuan: saved.amountYuan,
            }
          : null;
        if (!saved) return;

        // 优雅降级：存的值如果不在当前候选池里了（比如候选池以后又调整过），
        // 悄悄忽略、继续用这一刻算出来的默认值，不阻塞渲染也不报错。这些
        // setState 都是"恢复存档"，不是用户操作，不能碰 hasUserInteractedRef。
        if (holdCandidates.includes(saved.holdCurrency)) {
          setHoldCurrency(saved.holdCurrency);
          const savedTargetCandidates = resolveTargetCandidates(saved.holdCurrency);
          if (savedTargetCandidates.includes(saved.targetCurrency)) {
            setTargetCurrency(saved.targetCurrency);
          }
        }
        if (Number.isFinite(saved.amountYuan) && saved.amountYuan >= 0) {
          setAmountYuan(String(saved.amountYuan));
        }
        if (Array.isArray(saved.enabledCompareKeys)) {
          setEnabledCompareKeys(new Set(saved.enabledCompareKeys));
          // 把存档里提到过的卡标成"已经决定过"，避免"我的支付方式"卡片列表
          // 第一次异步到达时，下面 loadCardRecommendations 里"新卡默认勾选"
          // 那段逻辑把这些卡当成"没见过"又强制勾回来。存档之后才新增的卡
          // （存档里完全没提到过）依然会走"新卡默认勾选"这条既有规则，这是
          // 有意的取舍——见 PENDING-DECISIONS 这一轮记录，不是漏做。
          for (const key of saved.enabledCompareKeys) {
            if (key.startsWith('card:')) initializedCardKeysRef.current.add(key);
          }
        }
      } catch {
        // 拉取失败静默走默认值，不阻塞卡片渲染，不打扰用户。
      }
    }
    void loadPreference();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  // 保存 effect：持有币/目标币/自选比较项/金额任一变化都存一次，debounce 600ms
  // 避免打字/连续切换时每次改动都打一次接口。
  // fix(round66)：门槛从"存档有没有问完"（`preferenceLoadedRef`+`setTimeout(0)`，
  // 本地实测 6/6 次证实这套时序防抖不可靠，见上面 `hasUserInteractedRef` 定义处
  // 的大注释）换成"用户是不是真的手动改过某个输入"（`hasUserInteractedRef`）——
  // 组件挂载时的默认值计算、恢复存档、"新卡默认勾选"这类派生计算改的这几个
  // state，都不会把这个 ref 置 true，天然不会走到这里的 PUT。
  // 存 effectiveHold/effectiveTarget（已经做过候选池兜底校验的值）而不是原始
  // holdCurrency/targetCurrency，保证写进 D1 的值本身永远合法。
  useEffect(() => {
    if (!hasUserInteractedRef.current) return;
    const timer = setTimeout(() => {
      const nextSnapshot: FxComparePreferenceSnapshot = {
        holdCurrency: effectiveHold,
        targetCurrency: effectiveTarget,
        enabledCompareKeys: Array.from(enabledCompareKeys),
        amountYuan: amount,
      };
      // fix(round66)：双保险——跟已知最新存档内容完全一样就不发请求，即使上面
      // "只有用户操作才写"这层哪里有漏网也不会真的打一次多余的 PUT。按集合比较
      // enabledCompareKeys，不按数组顺序（同样内容不同插入顺序序列化出来的
      // JSON 字符串不一样，但语义上是同一份偏好，不能被顺序误判成"变了"）。
      if (isSameFxComparePreference(lastSavedSnapshotRef.current, nextSnapshot)) return;
      lastSavedSnapshotRef.current = nextSnapshot;
      void fetch(`/api/trips/${tripId}/fx-compare-preference`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(nextSnapshot),
      }).catch(() => {
        // 保存失败不打断记账主流程——这组选项只是体验优化，不是关键记账数据，
        // 静默失败即可，下次任何一个选项再变化会自然再触发一次保存。
      });
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveHold, effectiveTarget, amount, enabledCompareKeys]);

  // 实时中间汇率单独一个 effect，跟"我持有"/"目标币种"切换无关——这张表的形状
  // 跟具体选了哪个币种没关系，切换币种不用重新打这个请求，只有展开卡片第一次
  // 或者手动点"↻刷新"才需要问一次。
  async function loadLiveRates(forceRefresh: boolean) {
    setLiveRatesLoading(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/fx-mid-rates${forceRefresh ? '?forceRefresh=1' : ''}`);
      if (!res.ok) {
        setLiveRatesFailed(true);
        return;
      }
      const data = (await res.json()) as { rates: Record<string, number>; fetchedAt: string | null };
      setLiveRates(data.rates);
      setLiveRatesFetchedAt(data.fetchedAt);
      setLiveRatesFailed(false);
    } catch {
      setLiveRatesFailed(true);
    } finally {
      setLiveRatesLoading(false);
    }
  }

  useEffect(() => {
    if (expanded && liveRates === null && !liveRatesLoading) {
      void loadLiveRates(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  // 「我的支付方式」那组数字来自服务器（吃真实汇率+真实卡片设置），金额/目标币种
  // 变了要重新问一次；渠道那组是纯前端算，不用打网络请求（但中间价现在也来自
  // 实时汇率，不是写死数字了）。
  async function loadCardRecommendations(forceRefresh: boolean) {
    if (!showCards || !midRate || amount <= 0) {
      setCardRecommendations(null);
      return;
    }
    setCardsLoading(true);
    setCardsError(null);
    try {
      // 用当前生效的汇率（实时优先，抓不到才用离线表）把"我持有的本位币金额"
      // 换算成"notional 目标币种金额"，再拿这个金额去问真实的每张卡成本——这个
      // 换算只是为了决定"体验上大概花多少目标币种"，卡片本身的实际成本数字
      // 还是服务器用实时汇率算的，不是这里估的。
      const notionalTargetAmount = Math.round(amount * midRate * 100); // 分
      // fix(2026-09-26 第七十一轮，任务③)：显式传 compareCurrency=effectiveHold，
      // 不再依赖服务器端默认退回 trip.baseCurrency——见文件顶部大注释第 8 点，
      // impliedRate 公式的数学前提就是靠这个显式传参保证的。
      const res = await fetch(`/api/trips/${tripId}/fx-recommendation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          amount: notionalTargetAmount,
          expenseCurrency: effectiveTarget,
          forceRefresh,
          compareCurrency: effectiveHold,
        }),
      });
      if (!res.ok) {
        setCardsError('我的支付方式比价失败，检查一下网络');
        setCardRecommendations(null);
        return;
      }
      const data = (await res.json()) as { recommendations: FxRecommendationResult[] };
      setCardRecommendations(data.recommendations);
      // fix(2026-09-23 第三十三轮，方案二)：卡片列表这一刻才第一次真的到达浏览器——
      // 把"没见过"的卡默认勾进 enabledCompareKeys（不然它们一出现就已经被排除在
      // 比较范围外，用户还没机会看过就先被过滤掉了），"见过"的卡不重复处理，尊重
      // 用户手动取消勾选过的状态。
      setEnabledCompareKeys((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const r of data.recommendations) {
          const key = `card:${r.paymentMethodId}`;
          if (!initializedCardKeysRef.current.has(key)) {
            initializedCardKeysRef.current.add(key);
            next.add(key);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    } finally {
      setCardsLoading(false);
    }
  }

  useEffect(() => {
    if (expanded) void loadCardRecommendations(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, effectiveHold, effectiveTarget, showCards, liveRates]);

  const visibleChannels = STATIC_CHANNELS.filter((c) => enabledCompareKeys.has(`channel:${c.key}`));

  const channelRows: CompareRow[] = midRate
    ? visibleChannels.map((c) => {
        const effectiveRate = midRate * (1 + c.spread);
        return {
          key: `channel-${c.key}`,
          label: c.name,
          note: c.key === 'atm' ? formatAtmFeeNote(effectiveTarget, activeRates) : c.note,
          kind: 'channel',
          effectiveRate,
          amountInTarget: amount * effectiveRate,
          requiresConversion: true,
        };
      })
    : [];

  const cardRows: CompareRow[] = showCards
    ? (cardRecommendations ?? [])
        // fix(2026-09-26 第七十一轮，任务③)：只列出结算币种刚好是"我持有"这个币种
        // 的卡——不是任意一张卡都能跟"我持有多少 XX 币"这件事挂钩，比如我持有 MYR，
        // 只有结算币种也是 MYR 的卡/现金才有意义比较，结算币种是 THB 的卡拿来跟
        // "我持有 MYR" 比没有数学意义。
        .filter((r) => r.settlementCurrency === effectiveHold)
        .filter((r) => enabledCompareKeys.has(`card:${r.paymentMethodId}`))
        .map((r) => {
          const notionalTargetAmountYuan = midRate ? amount * midRate : null;
          const costYuan = r.costInCompareCurrency !== null ? centsToYuan(r.costInCompareCurrency) : null;
          const impliedRate =
            notionalTargetAmountYuan && costYuan && costYuan > 0 ? notionalTargetAmountYuan / costYuan : null;
          // fix(2026-09-24，Remy 真实反馈的真 bug)：这行文案之前硬编码"刷卡支付"，
          // 连"现金"支付方式（r.kind==='cash'）也这么标，Remy 真实"现金"支付方式
          // 明明不是刷卡。改成按 r.kind 分——现金/卡各自的文案。同时把 API 早就算
          // 好但一直被这里丢掉的 `r.requiresConversion` 接进来：同币种（比如"现金
          // USD"付 USD 计价的东西）不需要经过任何换汇步骤，文案上明确标"无需换汇"，
          // 不是又是套用跟别的支付方式一样的"折合花 X"话术——即使显示的 X 数值
          // 因为汇率加点/手续费都是 0% 而跟别的支付方式凑巧一样（这不是算法 bug，
          // 是 Remy 目前给这几个支付方式配置的费率本来就都是 0%，详见
          // PENDING-DECISIONS 这一轮的记录），文案至少要如实说明"这笔是不需要
          // 换汇的"，不能让人误以为算法没有考虑币种差异。
          const paymentModeLabel = r.kind === 'cash' ? '现金支付' : '刷卡支付';
          // fix(2026-09-26 第七十一轮，任务③)：这行文案原来硬编码 baseCurrency——
          // costYuan 现在是"花掉多少我持有的 effectiveHold"（compareCurrency 已经
          // 显式传成 effectiveHold，不再总是等于 baseCurrency），文案要跟着改用
          // effectiveHold，不然 hold≠base 时数字单位跟文案说的币种对不上。
          const note =
            r.unavailable || costYuan === null
              ? '汇率缺失，建议手动核对'
              : r.requiresConversion
                ? r.cashMarkupEstimated
                  ? `现金去换钱店换 · 按约 ${DEFAULT_CASH_EXCHANGE_MARKUP_PERCENT.toFixed(1)}% 损耗估算，折合花 ${costYuan.toFixed(2)} ${effectiveHold}（可在支付方式里填实际加点）`
                  : `${paymentModeLabel} · 折合花 ${costYuan.toFixed(2)} ${effectiveHold}`
                : `${paymentModeLabel} · 同币种可直接用，无需换汇，约合 ${costYuan.toFixed(2)} ${effectiveHold}`;
          return {
            key: `card-${r.paymentMethodId}`,
            label: r.label,
            note,
            kind: 'card',
            effectiveRate: impliedRate,
            amountInTarget: impliedRate ? amount * impliedRate : null,
            requiresConversion: r.requiresConversion,
          };
        })
    : [];

  const allRows = [...channelRows, ...cardRows]
    .filter((r) => r.effectiveRate !== null)
    .sort((a, b) => (b.effectiveRate ?? 0) - (a.effectiveRate ?? 0));

  // fix(2026-09-24 第五十八轮，Remy 报真 bug"同币种不该拿最划算徽章")：
  // 每一行各自记住自己在 `allRows`（全局排序后）里的原始位置（`globalIndex`），
  // 渲染时用这个位置去跟"该拿徽章的那一行"比对，不受分组视觉拆分影响。
  const indexedRows = allRows.map((row, globalIndex) => ({ ...row, globalIndex }));
  // fix(2026-09-24 第五十八轮，Remy 报"渠道换汇/我的支付方式两组数字排在一起容易
  // 看串"）：从一个扁平列表改成两个视觉上明显分开的分组，各自一个小标题，顺序
  // 按 Remy 截图里出现的先后——渠道在前、我的支付方式在后。
  const channelGroupRows = indexedRows.filter((r) => r.kind === 'channel');
  const cardGroupRows = indexedRows.filter((r) => r.kind === 'card');
  // fix(第六十八轮，任务 K，Remy 明确要求)："我的支付方式"这组可比较的行数是 0
  // 时（两种情况：①这趟行程根本没配置任何支付方式，②配了但没有一张结算币种
  // 匹配当前"我持有"——`showCards`/`cardRows` 在这两种情况下本来就已经是空，
  // `cardGroupRows.length === 0` 天然覆盖这两种情况，不用另外判断），用户此刻
  // 完全看不到任何"我的支付方式"数据，"渠道换汇"是唯一能看的参考数据，不该还
  // 要求他们多点一下才能看到——这里把它跟手动的 `channelGroupExpanded` 状态
  // 做 OR，纯粹是渲染时的派生值，不新增 state、不碰 `markUserInteracted()`，
  // 跟 round66"零交互也不该 PUT"的原则完全不冲突（`channelGroupExpanded` 本身
  // 的写入路径一个字没动，见下面 fx-compare-card.test.tsx 新增的 0 PUT 用例）。
  const effectiveChannelExpanded = channelGroupExpanded || cardGroupRows.length === 0;
  // fix(2026-09-26 第七十一轮，任务③-②，Remy 明确要求)："✓最划算"徽章推翻第
  // 六十五轮"只在我的支付方式内部比"这条收窄，改回跨用户当前**实际看得到**的
  // 全部行比较——渠道组折叠时用户根本看不到那几行，让它们参与"当前最划算"的
  // 判定没有意义（点开之后才重新算进来，`visibleForBestOffer` 依赖
  // `effectiveChannelExpanded`，折叠状态一变这个列表自然跟着变）。用回全局
  // 通用的 `findBestOfferIndex`（不再是收窄到 kind==='card' 子集的
  // `findBestCardOfferGlobalIndex`），在筛出来的可见子集里找第一个有资格的行，
  // 再把子集内的下标换算回 `globalIndex`（`indexedRows` 全局排序的原始位置），
  // 保证跟 `groups`/`row.globalIndex === firstEligibleIndex` 这套渲染判断兼容。
  const visibleForBestOffer = indexedRows.filter((r) => r.kind === 'card' || effectiveChannelExpanded);
  const posWithinVisible = findBestOfferIndex(visibleForBestOffer);
  const bestRow = posWithinVisible >= 0 ? visibleForBestOffer[posWithinVisible]! : null;
  const firstEligibleIndex = bestRow ? bestRow.globalIndex : -1;
  // 顶部一行结论要用的"第二名"——跟最划算比一比省了多少，纯展示，找不到第二名
  // （只有一行可比）就不显示这段比较文字，只显示"最划算是谁"。资格判断跟
  // `findBestOfferIndex` 同一套（未标记 unavailable + 需要经过换汇），从
  // `bestRow` 之后接着找，不是随便找一行"另一行"——要的是真正的排名第二。
  const secondBestRow =
    bestRow !== null
      ? (visibleForBestOffer.slice(posWithinVisible + 1).find((r) => r.requiresConversion) ?? null)
      : null;
  // fix(第六十五轮，Remy 明确要求)："渠道换汇"这组默认收起（`channelGroupExpanded`
  // 初始 false），只有展开时才算进"可见分组"列表。`visibleGroups` 只用来决定要不要
  // 渲染组标题——只剩一组可见时（最常见的默认态：只有"我的支付方式"）标题是多余的，
  // 两组都可见（用户点开"看换汇渠道参考价"之后）才各自需要标题区分。
  const groups: { key: string; title: string; rows: typeof indexedRows }[] = [
    ...(effectiveChannelExpanded && channelGroupRows.length > 0
      ? [{ key: 'channel', title: '渠道换汇（参考价）', rows: channelGroupRows }]
      : []),
    ...(cardGroupRows.length > 0 ? [{ key: 'card', title: '我的支付方式', rows: cardGroupRows }] : []),
  ];
  const showGroupTitles = groups.length > 1;

  // fix(第六十六轮，bug G)：基准换算卡片实际会渲染出几张，取决于
  // `deriveMidRate` 有没有查得到数据，不能假设永远是 QUICK_BASE_CARD_CURRENCIES
  // 的全部 4 项。这里先算出真实要渲染的列表（含每项的汇率），网格列数
  // （`quickBaseGridClassName`）按这个真实长度选，不是按候选池固定长度选。
  const quickBaseCards = QUICK_BASE_CARD_CURRENCIES.map((h) => {
    const rate = effectiveTarget ? deriveMidRate(activeRates, h, effectiveTarget) : undefined;
    return rate === undefined ? null : { h: h as string, rate };
  }).filter((entry): entry is { h: string; rate: number } => entry !== null);

  // fix(2026-09-23 第三十三轮，方案二)：改名自 toggleChannel，现在管两种 key
  // （channel:xxx / card:xxx），逻辑本身（勾选/取消勾选同一个 Set）没有变化。
  function toggleCompareKey(key: string) {
    // fix(round66)：这是四个真实用户操作入口之一（另外三个是我持有/目标币种
    // 下拉、兑换金额输入框），只有这几处会把 hasUserInteractedRef 置 true。
    markUserInteracted();
    setEnabledCompareKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <section className="fx-section flex flex-col gap-3 rounded-hero border border-sand bg-paper p-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-left text-[10px] uppercase tracking-[0.08em] text-neutral-dk"
        >
          💱 汇率比价 → {effectiveTarget}
          <span className="ml-1 normal-case tracking-normal">{expanded ? '▲' : '▼'}</span>
        </button>
      </div>

      {expanded && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-[5px]">
            {/* fix(2026-09-17 第二十轮，Remy 明确要求"conversion这里也要可选择从
                什么币种convert到什么币种")：之前"我持有"是一排写死的胶囊 tab
                （见下面被删掉的那段），只能在 holdCandidates 允许的范围里点选，
                跟"🎯目标币种"那个能点开菜单挑的下拉比，视觉上像是"起点不能选，
                终点才能选"——这不是方案要求的（方案本身"我持有"也是固定 tab，
                这条是 Remy 这轮在方案基础上加的新要求，如实记这是新判断不是
                方案原文）。改成跟目标币种同一套"点开小菜单选"的交互，可选范围
                还是 holdCandidates（这套汇率数据支持当基准的币种——不是无限任意
                币种，扩到更多基准需要 open.er-api.com 那边也能查到对应汇率）。
                fix(2026-09-23 第三十七轮，Remy 报真 bug"选项太少")：这里原本只有
                MYR/USD/HKD/CNY 四选，而且还会被 enabledCurrencies 再收窄一次，
                真实行程上排除掉当前目标币种后最终只剩 3 个——扩到 8 选
                （`HOLD_CURRENCY_CANDIDATES`，见 `lib/fx/fx-compare-defaults.ts`
                顶部大注释），不再用 enabledCurrencies 收窄可选范围。 */}
            {/* fix(2026-09-24 第三十九轮，团队看板反馈"点空白/Escape 关不掉")：这两个
                下拉之前是各自手搓的 `useState` + `absolute` 面板，没接住空白点击/Escape
                （根因见 `components/select-dropdown.tsx` 顶部说明）。这两个都是"选一个
                值触发 onChange"的单选形状，结构上跟 `SelectDropdown` 完全吻合，直接换成
                调用它本体（不是再抽一份关闭逻辑出来抄），关闭行为、键盘习惯从此跟全站
                其它下拉共用同一份实现，不会再单独漏。触发按钮样式用 `triggerClassName`
                还原成原来的圆角胶囊，`renderValue` 还原原来的按钮文案（"我持有"这颗要
                显示当前选中值，"目标币种"这颗原本就是固定文案、不随选中值变，两边都照
                原样保留，这次只换实现不换外观）。 */}
            <SelectDropdown
              value={effectiveHold}
              onChange={(v) => {
                markUserInteracted();
                setHoldCurrency(v);
              }}
              options={holdCandidates
                .filter((h) => h !== effectiveTarget)
                .map((h) => ({ value: h, label: h }))}
              ariaLabel="我持有的币种"
              triggerClassName="rounded-full bg-neutral-lt px-[9px] py-[5px] text-[10px] font-medium text-neutral-dk"
              // fix(2026-09-26 第七十二轮第四批，合并方案A+C)：panelClassName 收窄成
              // 只管外观，定位/z-index/圆角/max-height 这几项现在固定由 SelectDropdown
              // 组件本体算好（窄屏方案C底部抽屉/宽屏方案A智能开合悬浮面板两套定位），
              // 这里不用再重复传一遍圆角。
              panelClassName="min-w-[110px] border border-sand bg-white p-1 shadow-card"
              renderValue={() => `💰 我持有 ${effectiveHold || '…'}`}
            />

            {/* 🎯目标币种 下拉——Artifact `.fchip`/`.fdrop-menu` 规格 */}
            <SelectDropdown
              value={effectiveTarget}
              onChange={(v) => {
                markUserInteracted();
                setTargetCurrency(v);
              }}
              options={targetCandidates.map((c) => ({ value: c, label: TARGET_CURRENCY_LABELS[c] ?? c }))}
              ariaLabel="目标币种"
              triggerClassName="rounded-full bg-neutral-lt px-[9px] py-[5px] text-[10px] font-medium text-neutral-dk"
              panelClassName="min-w-[110px] border border-sand bg-white p-1 shadow-card"
              renderValue={() => '🎯 目标币种'}
            />

            {/* ⚙自选比较项 下拉——fix(2026-09-23 第三十三轮，方案二)：改名自"⚙自选渠道"，
                合并了 5 个固定渠道 + 真实支付方式两组勾选框到同一个下拉、同一套 Set，
                不再是两个互相不知道对方存在的独立开关。 */}
            <div ref={channelContainerRef} className="relative">
              <button
                type="button"
                onClick={() => setChannelOpen((v) => !v)}
                className="rounded-full bg-neutral-lt px-[9px] py-[5px] text-[10px] font-medium text-neutral-dk"
              >
                ⚙ 自选比较项 ▾
              </button>
              {channelOpen && (
                <div className="absolute left-0 top-full z-10 mt-1 min-w-[170px] rounded-[10px] border border-sand bg-white p-1 shadow-card">
                  <div className="px-[6px] pb-[2px] pt-[3px] text-[8.5px] font-semibold uppercase tracking-wide text-neutral-dk">
                    渠道
                  </div>
                  {/* fix(2026-09-24，团队看板 id=2026-09-24_153503_855780ae，Remy 明确要求)：
                      原生方框 checkbox 换成全站统一的深色开关组件——跟"支付方式"页
                      "本行程启用的支付方式"那批（`payment-methods-manager.tsx`）复用
                      同一个 `components/switch.tsx`，不是另写一套新样式，`Switch`/`label`
                      同级摆放（不是 label 包 Switch）也照抄那边的结构。round46 已经
                      查清楚这处在 Artifact 权威设计源里本来就是原生 checkbox（不是漏改），
                      这次是 Remy 在方案基础上明确要求"全站 checkbox 一律统一成开关"才
                      纳入范围，不是擅自扩大范围。 */}
                  {STATIC_CHANNELS.map((c) => (
                    <div
                      key={c.key}
                      className="flex items-center gap-1.5 whitespace-nowrap rounded-[7px] px-[6px] py-[4px] hover:bg-neutral-lt"
                    >
                      <Switch
                        id={`fx-compare-channel-${c.key}`}
                        checked={enabledCompareKeys.has(`channel:${c.key}`)}
                        onChange={() => toggleCompareKey(`channel:${c.key}`)}
                        ariaLabel={`比较渠道「${c.name}」`}
                      />
                      <label htmlFor={`fx-compare-channel-${c.key}`} className="flex-1 text-[10.5px] text-ink">
                        {c.name}
                      </label>
                    </div>
                  ))}
                  {showCards && (
                    <>
                      <div className="mt-[2px] border-t border-sand px-[6px] pb-[2px] pt-[5px] text-[8.5px] font-semibold uppercase tracking-wide text-neutral-dk">
                        我的方式
                      </div>
                      {/* fix(2026-09-23 第三十三轮)：卡片列表异步拉取，还没拉回来之前
                          不能显示空的勾选框（用户会以为"我的方式"就是空的、可以勾但
                          勾了也没东西），用文字占位说明还在加载。 */}
                      {cardsLoading && cardRecommendations === null ? (
                        <p className="px-[6px] py-[4px] text-[10px] text-neutral-dk">加载中…</p>
                      ) : (cardRecommendations ?? []).length === 0 ? (
                        <p className="px-[6px] py-[4px] text-[10px] text-neutral-dk">暂无支付方式</p>
                      ) : (
                        (cardRecommendations ?? []).map((r) => (
                          <div
                            key={r.paymentMethodId}
                            className="flex items-center gap-1.5 whitespace-nowrap rounded-[7px] px-[6px] py-[4px] hover:bg-neutral-lt"
                          >
                            <Switch
                              id={`fx-compare-card-${r.paymentMethodId}`}
                              checked={enabledCompareKeys.has(`card:${r.paymentMethodId}`)}
                              onChange={() => toggleCompareKey(`card:${r.paymentMethodId}`)}
                              ariaLabel={`比较我的支付方式「${r.label}」`}
                            />
                            <label
                              htmlFor={`fx-compare-card-${r.paymentMethodId}`}
                              className="flex-1 text-[10.5px] text-ink"
                            >
                              {r.label}
                            </label>
                          </div>
                        ))
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                // fix(2026-09-17 第二十二轮)：刷新按钮现在也要重新拉一次实时中间汇率，
                // 不只是刷"我的支付方式"那组——不然点了"↻刷新"渠道那组数字纹丝不动，
                // 用户会以为按钮坏了。
                void loadLiveRates(true);
                void loadCardRecommendations(true);
              }}
              disabled={cardsLoading || liveRatesLoading}
              className="rounded-full bg-neutral-lt px-[9px] py-[5px] text-[10px] font-medium text-neutral-dk disabled:opacity-50"
            >
              {cardsLoading || liveRatesLoading ? '刷新中…' : '↻ 刷新'}
            </button>
          </div>

          {/* 基准换算卡片 + 「我持有」tab——Artifact `.fx-base-row` + `.navtabs`。
              故意用 QUICK_BASE_CARD_CURRENCIES（固定 4 个）不用 holdCandidates
              （下拉候选池，2026-09-23 扩到 8 个）——这排卡片是"补两张基准卡"的
              快速参考展示，不该跟着下拉选项数量一起涨到 8 张。
              fix(第六十六轮，bug G)：先把实际能渲染出来的几张卡算出来
              （`deriveMidRate` 缺数据的会被过滤掉，不是永远都是 4 张），拿这个
              真实数量去选网格列数——只改排列方式，卡片本身宽度/圆角/字号都
              没有变。 */}
          <div data-testid="quick-base-grid" className={quickBaseGridClassName(quickBaseCards.length)}>
            {quickBaseCards.map(({ h, rate }) => (
              <div
                key={h}
                className="flex flex-col items-center gap-0.5 rounded-[14px] border border-sand bg-white px-[8px] py-[7px] shadow-card"
              >
                <span className="text-[9px] text-neutral-dk">1 {h}</span>
                <span className="font-serif text-[12.5px] font-semibold tabular-nums text-ink">
                  = {rate.toFixed(3)} {FX_SYMBOLS[effectiveTarget] ?? ''}
                </span>
              </div>
            ))}
          </div>

          {/* fix(2026-09-17 第二十轮)：原本这里还有一排"我持有→目标"的写死胶囊 tab，
              现在换成了上面header那个"💰我持有"下拉，这排 tab 整个删掉不再重复
              一次同样的选择——两套 UI 表达同一件事没有意义。当前选到哪个"我持有"
              靠上面下拉按钮自己的文字（"💰我持有 HKD ▾"）显示，不需要额外的 tab
              再显示一遍。 */}

          <div className="flex flex-col gap-1">
            <label className="field-label" htmlFor="fx-compare-amount">
              兑换金额 ({effectiveHold})
            </label>
            <input
              id="fx-compare-amount"
              ref={amountInputRef}
              type="text"
              inputMode="decimal"
              value={formatThousands(amountYuan)}
              onChange={(e) => {
                const rawInput = e.target.value;
                // fix(第六十七轮，任务 H)：光标锚点必须在"剥逗号之前"、拿浏览器已经
                // 原生插入这次按键之后的 `e.target.value` 算——逗号数量在剥逗号前后
                // 会变，但"有意义字符（数字/小数点）之前有几个"这个计数不受影响，
                // 是唯一能在两个字符串之间换算光标位置的锚点。
                const selectionStart = e.target.selectionStart ?? rawInput.length;
                const meaningfulBefore = countMeaningfulCharsBefore(rawInput, selectionStart);
                const candidate = stripThousands(rawInput);
                // 只允许数字 + 至多一个小数点（不允许负号/字母/多个小数点）；不合法
                // 的按键/粘贴直接当没发生过——不更新 state，也不调用
                // markUserInteracted()，保持"非法输入等于没输入"。
                if (!/^\d*\.?\d*$/.test(candidate)) return;
                markUserInteracted();
                pendingCursorMeaningfulCountRef.current = meaningfulBefore;
                setAmountYuan(candidate);
              }}
              onBlur={() => loadCardRecommendations(false)}
              className="field-input w-28 font-serif tabular-nums"
            />
          </div>

          {/* fix(2026-09-26 第七十一轮，任务③，推翻第三十三轮/第三十七轮这里原本
              "我持有必须===本位币"那条判断)：现在三选一看的是"有没有配支付方式"+
              "配的卡里有没有结算币种匹配我此刻持有的这个币种"（cardGroupRows），
              不再看我持有是不是等于本位币——我持有 MYR、本位币 HKD，只要有张卡
              结算币种也是 MYR，一样能列进来比。 */}
          {hasPaymentMethods && cardGroupRows.length > 0 ? (
            // fix(2026-09-23 第三十三轮，方案二)：原本这里是"一起比较我的支付方式"
            // 总开关（includeMyCards），现在退休——每张卡自己的勾选框已经并进上面
            // "⚙自选比较项"下拉，不需要再单独一个总开关重复控制同一件事。
            // fix(第六十七轮，任务 I，手机 390px 断行随意)：文案内容一个字没改，
            // 只给不该被硬拗断的术语短语（带引号的术语、"「支付方式」页"这类
            // 固定搭配、"⚙自选比较项"这个下拉名字）包一层 `whitespace-nowrap`，
            // 让浏览器只在这些短语的两侧折行，不会拦腰截断。
            <p className="text-[10px] text-neutral-dk">
              你在<span className="whitespace-nowrap">「支付方式」页</span>配置的支付方式已经并入上面
              <span className="whitespace-nowrap">&ldquo;⚙自选比较项&rdquo;</span>
              ，取消勾选哪张卡它就会从下面列表消失（只列出结算币种是
              <span className="whitespace-nowrap">「{effectiveHold}」</span>
              的那几张，用的是真实汇率加点/手续费）。
            </p>
          ) : !hasPaymentMethods ? (
            <p className="text-[10px] text-neutral-dk">
              先去{' '}
              <Link href={`/trips/${tripId}/payment-methods`} className="tap-link whitespace-nowrap">
                支付方式设置
              </Link>{' '}
              加几张卡/现金，就能一起比较刷卡划不划算。
            </p>
          ) : (
            <p className="text-[9.5px] text-neutral-dk">
              你目前没有结算币种是
              <span className="whitespace-nowrap">「{effectiveHold}」</span>
              的支付方式，先只看下面<span className="whitespace-nowrap">换汇渠道</span>
              参考价——去{' '}
              <Link href={`/trips/${tripId}/payment-methods`} className="tap-link whitespace-nowrap">
                支付方式设置
              </Link>{' '}
              加一张，或者换一个<span className="whitespace-nowrap">「我持有」</span>的币种。
            </p>
          )}

          {cardsError && <p className="text-[10px] text-coral">{cardsError}</p>}

          {!midRate ? (
            <p className="text-[10px] text-neutral-dk">
              这个币种组合暂时没有参考汇率，换一组
              <span className="whitespace-nowrap">「我持有/目标币种」</span>
              再看。
            </p>
          ) : allRows.length === 0 ? (
            <p className="text-[10px] text-neutral-dk">
              自选比较项都取消勾选了——去上面
              <span className="whitespace-nowrap">&ldquo;⚙自选比较项&rdquo;</span>
              里勾几个看看。
            </p>
          ) : (
            // fix(2026-09-24 第五十八轮，Remy 报真 bug"两组数字排在一起容易看串"，
            // 视觉/产品判断，取舍见 PENDING-DECISIONS)：原本一个扁平 <ul> 混排渠道跟
            // 我的支付方式，每行右上角一个小徽章区分来源——光看小徽章还是容易看串
            // （尤其两边都可能叫"Wise"这种同名行）。改成两个视觉上明显分开的分组，
            // 各自一个小标题（样式对齐 page.tsx 的 `<h2 className="text-[10px]
            // font-medium tracking-[0.08em] text-neutral-dk">` 规格，不新发明字号）。
            // 分组标题本身已经足够清楚"这行是渠道还是我的方式"，原来那个行内来源
            // 徽章判断为冗余，这次去掉，换取每行少一点视觉噪音（这是这次做的取舍，
            // 不是必然正确答案）。
            // fix(第六十五轮，Remy 明确要求"渠道换汇默认收起，列表底部一行小字链接
            // 展开")：`groups` 已经在上面按 `channelGroupExpanded` 过滤好了——默认
            // 只剩"我的支付方式"这一组，`showGroupTitles` 为 false（只有一组，标题
            // 是多余的）；点开链接后 `groups` 变成渠道+卡片两组，`showGroupTitles`
            // 变 true，两组各自要标题区分。展开/收起链接摆在整个列表最下面（渠道/
            // 卡片两组下方，脚注说明文字上方）。
            <div className="flex flex-col gap-3">
              {/* fix(2026-09-26 第七十一轮，任务③-③，Remy 明确要求"顶部要有一行
                  结论")：在逐行列表之前先给一句人话结论，不用用户自己扫一遍卡片
                  找哪个有徽章。跟下面卡片上的"✓最划算"徽章共用同一个 `bestRow`
                  （同一套 `visibleForBestOffer`/`findBestOfferIndex` 算出来的），
                  两处不会说法不一致。没有任何一行有资格拿"最划算"时（比如唯一
                  可比的一行是同币种不需要换汇）不渲染这句话，不硬凑文案。 */}
              {bestRow && (
                <p className="rounded-[10px] bg-[rgba(58,138,90,.1)] px-[10px] py-[7px] text-[11px] font-medium text-[#2f6b45]">
                  💡 最划算：{bestRow.label}
                  {secondBestRow && secondBestRow.effectiveRate && bestRow.effectiveRate
                    ? `，比 ${secondBestRow.label} 多换 ${(
                        ((bestRow.effectiveRate - secondBestRow.effectiveRate) / secondBestRow.effectiveRate) *
                        100
                      ).toFixed(1)}%`
                    : ''}
                </p>
              )}
              {groups.map((group) => (
                <div key={group.key} className="flex flex-col gap-[7px]">
                  {showGroupTitles && (
                    <h3 className="text-[10px] font-medium tracking-[0.08em] text-neutral-dk">{group.title}</h3>
                  )}
                  <ul className="flex flex-col gap-[7px]">
                    {group.rows.map((row) => (
                      <li
                        key={row.key}
                        className="rounded-[14px] border border-sand bg-white px-[10px] py-[8px] text-[11px]"
                      >
                        <div className="flex items-center justify-between gap-[6px] font-semibold">
                          <span>
                            {row.label}
                            {row.globalIndex === firstEligibleIndex && (
                              <span className="ml-1.5 inline-flex items-center rounded-full bg-ok px-[7px] py-[2px] align-middle text-[9px] font-bold text-white">
                                ✓最划算
                              </span>
                            )}
                          </span>
                          <span className="font-serif tabular-nums">
                            {row.amountInTarget !== null
                              ? `${FX_SYMBOLS[effectiveTarget] ?? ''}${row.amountInTarget.toFixed(2)}`
                              : '缺汇率'}
                          </span>
                        </div>
                        <div className="mt-[3px] text-[9.5px] text-neutral-dk">{row.note}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {/* fix(第六十八轮，任务 K)：这颗按钮的意义是"要不要在已经看得到我的
                  支付方式之外，额外多看一组渠道参考价"——`cardGroupRows.length === 0`
                  时渠道参考价已经是唯一能看的数据、被强制展开，点这颗按钮不会改变
                  任何东西（`effectiveChannelExpanded` 恒真），干脆不渲染，免得留一个
                  点了没反应的死按钮。 */}
              {channelGroupRows.length > 0 && cardGroupRows.length > 0 && (
                <button
                  type="button"
                  onClick={() => setChannelGroupExpanded((v) => !v)}
                  className="self-start text-[9.5px] text-neutral-dk underline underline-offset-2"
                >
                  {effectiveChannelExpanded ? '收起换汇渠道参考价 ▲' : '看换汇渠道参考价 ▾'}
                </button>
              )}
            </div>
          )}

          {/* fix(2026-09-17 第二十二轮)：这条脚注之前明确写"渠道那组是固定参考表，
              不是实时拉取"——现在已经不是了，改成如实描述数据来源+新鲜度，抓不到
              实时数据时也要明确说"这是离线参考汇率"，不能让用户以为一直都是实时的。 */}
          <p className="text-center text-[9px] text-neutral-dk">
            {usingFallbackRates
              ? liveRatesFailed
                ? '⚠️ 实时汇率暂时抓不到，以下用的是离线参考汇率，可能不是最新数字。'
                : '正在抓实时汇率…'
              : `中间汇率来自实时数据${liveRatesFetchedAt ? `，更新于 ${formatFetchedAt(liveRatesFetchedAt)}` : ''}（每 24 小时自动刷新一次，来源 open.er-api.com，跟"我的支付方式"那组同一个数据源）。`}
            <br />
            渠道那组（Wise/TNG跨境/ATM取款/换钱店/支付宝）= 实时中间价 × 各渠道固定点差/手续费百分比（点差/手续费是参考值，不是接口现查）；「我的支付方式」那组另外用了你自己配置的真实卡片加点/手续费——两组的加点精度不一样，但中间价这一层现在是同一个来源。
          </p>
        </div>
      )}
    </section>
  );
}
