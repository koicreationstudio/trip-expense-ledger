'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { yuanToCents, centsToYuan } from '@/lib/money';
import type { FxRecommendationResult } from '@/lib/domain/fx-recommendation';
import { deriveMidRate } from '@/lib/fx/derive-mid-rate';
import { resolveHoldCandidates, resolveTargetCandidates, resolveDefaultTarget } from '@/lib/fx/fx-compare-defaults';
import { SelectDropdown, useDismissableOpen } from '@/components/select-dropdown';
import { Switch } from '@/components/switch';

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
  { key: 'moneychanger', name: '换钱店', spread: -0.02512, note: '市区 Superrich · 约 -2.5%，机场更差' },
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

interface CompareRow {
  key: string;
  label: string;
  note: string;
  kind: 'channel' | 'card';
  effectiveRate: number | null; // 目标币种/持有币种，越大越划算；null=缺数据
  amountInTarget: number | null; // 按当前金额算出的目标币种到手数（用于展示）
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

  // fix(2026-09-23 第三十三轮，方案二)：这里只判断"有没有资格比较我的卡"（配置过
  // 支付方式 + 我持有等于行程本位币两条业务规则），不再叠加 includeMyCards 总开关——
  // "要不要显示某一张具体的卡"这件事下放给下面 enabledCompareKeys 逐卡过滤。
  const showCards = hasPaymentMethods && effectiveHold === baseCurrency;

  const fallbackMyrRates: Record<string, number> = { MYR: 1, ...FX_RATES_FALLBACK.MYR };
  const usingFallbackRates = liveRates === null;
  const activeRates = liveRates ?? fallbackMyrRates;
  const midRate = effectiveHold && effectiveTarget ? deriveMidRate(activeRates, effectiveHold, effectiveTarget) : undefined;
  const amount = Number(amountYuan) || 0;

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
      const res = await fetch(`/api/trips/${tripId}/fx-recommendation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: notionalTargetAmount, expenseCurrency: effectiveTarget, forceRefresh }),
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
        };
      })
    : [];

  const cardRows: CompareRow[] = showCards
    ? (cardRecommendations ?? [])
        .filter((r) => enabledCompareKeys.has(`card:${r.paymentMethodId}`))
        .map((r) => {
          const notionalTargetAmountYuan = midRate ? amount * midRate : null;
          const costYuan = r.costInCompareCurrency !== null ? centsToYuan(r.costInCompareCurrency) : null;
          const impliedRate =
            notionalTargetAmountYuan && costYuan && costYuan > 0 ? notionalTargetAmountYuan / costYuan : null;
          return {
            key: `card-${r.paymentMethodId}`,
            label: r.label,
            note:
              r.unavailable || costYuan === null
                ? '汇率缺失，建议手动核对'
                : `刷卡支付 · 折合花 ${costYuan.toFixed(2)} ${baseCurrency}`,
            kind: 'card',
            effectiveRate: impliedRate,
            amountInTarget: impliedRate ? amount * impliedRate : null,
          };
        })
    : [];

  const allRows = [...channelRows, ...cardRows]
    .filter((r) => r.effectiveRate !== null)
    .sort((a, b) => (b.effectiveRate ?? 0) - (a.effectiveRate ?? 0));

  // fix(2026-09-23 第三十三轮，方案二)：改名自 toggleChannel，现在管两种 key
  // （channel:xxx / card:xxx），逻辑本身（勾选/取消勾选同一个 Set）没有变化。
  function toggleCompareKey(key: string) {
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
              onChange={(v) => setHoldCurrency(v)}
              options={holdCandidates
                .filter((h) => h !== effectiveTarget)
                .map((h) => ({ value: h, label: h }))}
              ariaLabel="我持有的币种"
              triggerClassName="rounded-full bg-neutral-lt px-[9px] py-[5px] text-[10px] font-medium text-neutral-dk"
              panelClassName="absolute left-0 top-full z-10 mt-1 min-w-[110px] rounded-[10px] border border-sand bg-white p-1 shadow-card"
              renderValue={() => `💰 我持有 ${effectiveHold || '…'}`}
            />

            {/* 🎯目标币种 下拉——Artifact `.fchip`/`.fdrop-menu` 规格 */}
            <SelectDropdown
              value={effectiveTarget}
              onChange={(v) => setTargetCurrency(v)}
              options={targetCandidates.map((c) => ({ value: c, label: TARGET_CURRENCY_LABELS[c] ?? c }))}
              ariaLabel="目标币种"
              triggerClassName="rounded-full bg-neutral-lt px-[9px] py-[5px] text-[10px] font-medium text-neutral-dk"
              panelClassName="absolute left-0 top-full z-10 mt-1 min-w-[110px] rounded-[10px] border border-sand bg-white p-1 shadow-card"
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
              快速参考展示，不该跟着下拉选项数量一起涨到 8 张。 */}
          <div className="flex flex-wrap gap-[6px]">
            {QUICK_BASE_CARD_CURRENCIES.map((h) => {
              const rate = effectiveTarget ? deriveMidRate(activeRates, h, effectiveTarget) : undefined;
              if (rate === undefined) return null;
              return (
                <div
                  key={h}
                  className="flex min-w-[90px] flex-1 flex-col items-center gap-0.5 rounded-[14px] border border-sand bg-white px-[8px] py-[7px] shadow-card"
                >
                  <span className="text-[9px] text-neutral-dk">1 {h}</span>
                  <span className="font-serif text-[12.5px] font-semibold tabular-nums text-ink">
                    = {rate.toFixed(3)} {FX_SYMBOLS[effectiveTarget] ?? ''}
                  </span>
                </div>
              );
            })}
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
              type="number"
              min="0"
              step="1"
              value={amountYuan}
              onChange={(e) => setAmountYuan(e.target.value)}
              onBlur={() => loadCardRecommendations(false)}
              className="field-input w-28 font-serif tabular-nums"
            />
          </div>

          {hasPaymentMethods && effectiveHold === baseCurrency ? (
            // fix(2026-09-23 第三十三轮，方案二)：原本这里是"一起比较我的支付方式"
            // 总开关（includeMyCards），现在退休——每张卡自己的勾选框已经并进上面
            // "⚙自选比较项"下拉，不需要再单独一个总开关重复控制同一件事。
            <p className="text-[10px] text-neutral-dk">
              你在「支付方式」页配置的支付方式已经并入上面&ldquo;⚙自选比较项&rdquo;，取消勾选哪张卡它就会从下面列表消失（用的是真实汇率加点/手续费）。
            </p>
          ) : (
            !hasPaymentMethods && (
              <p className="text-[10px] text-neutral-dk">
                先去{' '}
                <Link href={`/trips/${tripId}/payment-methods`} className="tap-link">
                  支付方式设置
                </Link>{' '}
                加几张卡/现金，&ldquo;我持有 {baseCurrency}&rdquo;时就能一起比较刷卡划不划算。
              </p>
            )
          )}
          {hasPaymentMethods && effectiveHold !== baseCurrency && (
            <p className="text-[9.5px] text-neutral-dk">
              「我持有」选的不是这趟行程本位币（{baseCurrency}）时，只比较换汇渠道，不比较我的支付方式——两者的钱是从不同基准算出来的，混在一起比不公平。
            </p>
          )}

          {cardsError && <p className="text-[10px] text-coral">{cardsError}</p>}

          {!midRate ? (
            <p className="text-[10px] text-neutral-dk">这个币种组合暂时没有参考汇率，换一组「我持有/目标币种」再看。</p>
          ) : allRows.length === 0 ? (
            <p className="text-[10px] text-neutral-dk">
              自选比较项都取消勾选了——去上面&ldquo;⚙自选比较项&rdquo;里勾几个看看。
            </p>
          ) : (
            <ul className="flex flex-col gap-[7px]">
              {allRows.map((row, i) => (
                <li
                  key={row.key}
                  className="rounded-[14px] border border-sand bg-white px-[10px] py-[8px] text-[11px]"
                >
                  <div className="flex items-center justify-between gap-[6px] font-semibold">
                    <span>
                      {row.label}
                      {/* fix(2026-09-23 第三十三轮，方案二，对应 Remy 报的真 bug C)：
                          来源徽章——渠道比价跟我的支付方式现在合并成同一张列表，
                          两边都可能出现同名行（比如都叫"Wise"），没有这个标签会
                          让人以为是重复行。复用 expense-list.tsx 已有的中性徽章
                          样式（`bg-[rgba(164,163,160,.2)]`），不新开一套配色。 */}
                      <span className="ml-1.5 inline-flex items-center rounded-full bg-[rgba(164,163,160,.2)] px-[6px] py-[1px] align-middle text-[8.5px] font-medium text-muted">
                        {row.kind === 'channel' ? '渠道' : '我的方式'}
                      </span>
                      {i === 0 && (
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
