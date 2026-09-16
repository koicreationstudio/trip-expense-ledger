'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { yuanToCents, centsToYuan } from '@/lib/money';
import type { FxRecommendationResult } from '@/lib/domain/fx-recommendation';

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
 */

const FX_RATES: Record<string, Record<string, number>> = {
  MYR: { THB: 8.12, USD: 0.245, SGD: 0.318, CNY: 1.61, HKD: 1.92 },
  USD: { THB: 33.03, MYR: 4.08, SGD: 1.3, CNY: 6.58, HKD: 7.82 },
  HKD: { THB: 4.229, USD: 0.1276, SGD: 0.1656, CNY: 0.8385, MYR: 0.5208 },
};

const FX_SYMBOLS: Record<string, string> = {
  THB: '฿',
  USD: '$',
  SGD: 'S$',
  CNY: '¥',
  HKD: 'HK$',
  MYR: 'RM',
};

const TARGET_CURRENCY_LABELS: Record<string, string> = {
  THB: 'THB 泰铢',
  USD: 'USD 美金',
  SGD: 'SGD 新币',
  CNY: 'CNY 人民币',
  HKD: 'HKD 港币',
  MYR: 'MYR 令吉',
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

function formatAtmFeeNote(targetCurrency: string): string {
  const myrRates = FX_RATES.MYR;
  const thbPerMyr = myrRates?.THB;
  const targetPerMyr = targetCurrency === 'MYR' ? 1 : myrRates?.[targetCurrency];
  if (thbPerMyr === undefined || targetPerMyr === undefined) {
    return 'ATM 取款：银行外汇费约 2% + 固定手续费';
  }
  const feeInTarget = (220 * targetPerMyr) / thbPerMyr;
  const rounded = feeInTarget >= 100 ? Math.round(feeInTarget) : Math.round(feeInTarget * 10) / 10;
  const symbol = FX_SYMBOLS[targetCurrency] ?? '';
  return `银行外汇费约 2% + ${symbol}${rounded} 固定手续费`;
}

function resolveHoldCandidates(enabledCurrencies: string[] | null): string[] {
  const allHolds = Object.keys(FX_RATES);
  if (!enabledCurrencies || enabledCurrencies.length === 0) return allHolds;
  return allHolds.filter((h) => enabledCurrencies.includes(h));
}

function resolveTargetCandidates(hold: string, enabledCurrencies: string[] | null): string[] {
  const keys = Object.keys(FX_RATES[hold] ?? {}).filter((c) => c !== hold);
  if (!enabledCurrencies || enabledCurrencies.length === 0) return keys;
  const filtered = keys.filter((c) => enabledCurrencies.includes(c));
  return filtered.length > 0 ? filtered : keys;
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
  const [targetOpen, setTargetOpen] = useState(false);
  const [channelOpen, setChannelOpen] = useState(false);

  const holdCandidates = resolveHoldCandidates(enabledCurrencies);
  // 默认"我持有"优先选这趟行程的本位币（这样默认就能同时看到渠道+我的卡两组数据，
  // 不用用户自己再切一次）；本位币不在 FX_RATES 支持范围内（老行程/冷门币种）才退回
  // 候选清单第一项。
  const [holdCurrency, setHoldCurrency] = useState<string>(
    holdCandidates.includes(baseCurrency) ? baseCurrency : (holdCandidates[0] ?? 'MYR')
  );
  const effectiveHold = holdCandidates.includes(holdCurrency) ? holdCurrency : (holdCandidates[0] ?? '');
  const targetCandidates = effectiveHold ? resolveTargetCandidates(effectiveHold, enabledCurrencies) : [];

  const [targetCurrency, setTargetCurrency] = useState<string>('THB');
  const effectiveTarget = targetCandidates.includes(targetCurrency) ? targetCurrency : (targetCandidates[0] ?? '');

  const [amountYuan, setAmountYuan] = useState('1000');
  const [enabledChannelKeys, setEnabledChannelKeys] = useState<Set<string>>(
    new Set(STATIC_CHANNELS.map((c) => c.key))
  );
  const [includeMyCards, setIncludeMyCards] = useState(true);

  const [cardRecommendations, setCardRecommendations] = useState<FxRecommendationResult[] | null>(null);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [cardsError, setCardsError] = useState<string | null>(null);

  const showCards = includeMyCards && hasPaymentMethods && effectiveHold === baseCurrency;

  const midRate = effectiveHold && effectiveTarget ? FX_RATES[effectiveHold]?.[effectiveTarget] : undefined;
  const amount = Number(amountYuan) || 0;

  // 「我的支付方式」那组数字来自服务器（吃真实汇率+真实卡片设置），金额/目标币种
  // 变了要重新问一次；渠道那组是纯前端算，不用打网络请求。
  async function loadCardRecommendations(forceRefresh: boolean) {
    if (!showCards || !midRate || amount <= 0) {
      setCardRecommendations(null);
      return;
    }
    setCardsLoading(true);
    setCardsError(null);
    try {
      // 用静态参考汇率把"我持有的本位币金额"换算成"notional 目标币种金额"，
      // 再拿这个金额去问真实的每张卡成本——这个换算只是为了决定"体验上大概花多少
      // 目标币种"，卡片本身的实际成本数字还是服务器用实时汇率算的，不是这里估的。
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
    } finally {
      setCardsLoading(false);
    }
  }

  useEffect(() => {
    if (expanded) void loadCardRecommendations(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, effectiveHold, effectiveTarget, showCards]);

  const visibleChannels = STATIC_CHANNELS.filter((c) => enabledChannelKeys.has(c.key));

  const channelRows: CompareRow[] = midRate
    ? visibleChannels.map((c) => {
        const effectiveRate = midRate * (1 + c.spread);
        return {
          key: `channel-${c.key}`,
          label: c.name,
          note: c.key === 'atm' ? formatAtmFeeNote(effectiveTarget) : c.note,
          kind: 'channel',
          effectiveRate,
          amountInTarget: amount * effectiveRate,
        };
      })
    : [];

  const cardRows: CompareRow[] = showCards
    ? (cardRecommendations ?? []).map((r) => {
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

  function toggleChannel(key: string) {
    setEnabledChannelKeys((prev) => {
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
          className="flex items-center gap-1 text-left text-[10px] uppercase tracking-[0.08em] text-gold-dk"
        >
          💱 汇率比价 → {effectiveTarget}
          <span className="ml-1 normal-case tracking-normal">{expanded ? '▲' : '▼'}</span>
        </button>
      </div>

      {expanded && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-[5px]">
            {/* 🎯目标币种 下拉——Artifact `.fchip`/`.fdrop-menu` 规格 */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setTargetOpen((v) => !v);
                  setChannelOpen(false);
                }}
                className="rounded-full bg-gold-lt px-[9px] py-[5px] text-[10px] font-medium text-gold-dk"
              >
                🎯 目标币种 ▾
              </button>
              {targetOpen && (
                <div className="absolute left-0 top-full z-10 mt-1 min-w-[110px] rounded-[10px] border border-sand bg-white p-1 shadow-card">
                  {targetCandidates.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        setTargetCurrency(c);
                        setTargetOpen(false);
                      }}
                      className="block w-full whitespace-nowrap rounded-[7px] px-2 py-1.5 text-left text-[10.5px] text-ink hover:bg-gold-lt"
                    >
                      {TARGET_CURRENCY_LABELS[c] ?? c}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ⚙自选渠道 下拉——勾选框对应 5 个静态渠道 */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setChannelOpen((v) => !v);
                  setTargetOpen(false);
                }}
                className="rounded-full bg-gold-lt px-[9px] py-[5px] text-[10px] font-medium text-gold-dk"
              >
                ⚙ 自选渠道 ▾
              </button>
              {channelOpen && (
                <div className="absolute left-0 top-full z-10 mt-1 min-w-[170px] rounded-[10px] border border-sand bg-white p-1 shadow-card">
                  {STATIC_CHANNELS.map((c) => (
                    <label
                      key={c.key}
                      className="flex items-center gap-1.5 whitespace-nowrap rounded-[7px] px-[6px] py-[4px] text-[10.5px] text-ink hover:bg-gold-lt"
                    >
                      <input
                        type="checkbox"
                        checked={enabledChannelKeys.has(c.key)}
                        onChange={() => toggleChannel(c.key)}
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => loadCardRecommendations(true)}
              disabled={cardsLoading}
              className="rounded-full bg-gold-lt px-[9px] py-[5px] text-[10px] font-medium text-gold-dk disabled:opacity-50"
            >
              {cardsLoading ? '刷新中…' : '↻ 刷新'}
            </button>
          </div>

          {/* 基准换算卡片 + 「我持有」tab——Artifact `.fx-base-row` + `.navtabs` */}
          <div className="flex flex-wrap gap-[6px]">
            {holdCandidates.map((h) => {
              const rate = effectiveTarget ? FX_RATES[h]?.[effectiveTarget] : undefined;
              if (rate === undefined) return null;
              return (
                <div
                  key={h}
                  className="flex min-w-[90px] flex-1 flex-col items-center gap-0.5 rounded-[14px] border border-sand bg-white px-[8px] py-[7px] shadow-card"
                >
                  <span className="text-[9px] text-gold-dk">1 {h}</span>
                  <span className="font-serif text-[12.5px] font-semibold tabular-nums text-ink">
                    = {rate.toFixed(3)} {FX_SYMBOLS[effectiveTarget] ?? ''}
                  </span>
                </div>
              );
            })}
          </div>

          {/* fix(2026-09-16 第十八轮，自己走查真实截图抓到的真 bug)：这排"我持有→目标"
              tab 之前无条件把 holdCandidates 全部铺出来，没有排除"持有币种正好等于
              目标币种"这种自己换自己的无意义组合——真机截图上出现过"USD → USD"这种
              选项（这趟行程 enabledCurrencies 里 MYR/HKD/USD 都在，目标选到 USD 时
              就会连"USD → USD"一起列出来）。上面的基准换算卡片那块已经有
              `if (rate === undefined) return null` 兜底不会显示自己换自己（
              FX_RATES 表里没有一个币种对自己的汇率），但这排 tab 是独立渲染的，没有
              复用那层判断，漏了。 */}
          {holdCandidates.filter((h) => h !== effectiveTarget).length > 1 && (
            <div className="flex w-fit flex-wrap gap-1 rounded-full bg-gold-lt p-[3px] text-[10px]">
              {holdCandidates
                .filter((h) => h !== effectiveTarget)
                .map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setHoldCurrency(h)}
                  className={
                    effectiveHold === h
                      ? 'inline-flex items-center rounded-full bg-ink px-[10px] py-[5px] font-medium text-white'
                      : 'inline-flex items-center rounded-full px-[10px] py-[5px] font-medium text-gold-dk hover:text-ink'
                  }
                >
                  {h} → {effectiveTarget || '…'}
                </button>
              ))}
            </div>
          )}

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
            <label className="flex items-center gap-1.5 text-[10px] text-gold-dk">
              <input
                type="checkbox"
                checked={includeMyCards}
                onChange={(e) => setIncludeMyCards(e.target.checked)}
              />
              一起比较我的支付方式（用你在「支付方式」页配置的真实汇率加点/手续费）
            </label>
          ) : (
            !hasPaymentMethods && (
              <p className="text-[10px] text-gold-dk">
                先去{' '}
                <Link href={`/trips/${tripId}/payment-methods`} className="tap-link">
                  支付方式设置
                </Link>{' '}
                加几张卡/现金，&ldquo;我持有 {baseCurrency}&rdquo;时就能一起比较刷卡划不划算。
              </p>
            )
          )}
          {hasPaymentMethods && effectiveHold !== baseCurrency && (
            <p className="text-[9.5px] text-gold-dk">
              「我持有」选的不是这趟行程本位币（{baseCurrency}）时，只比较换汇渠道，不比较我的支付方式——两者的钱是从不同基准算出来的，混在一起比不公平。
            </p>
          )}

          {cardsError && <p className="text-[10px] text-coral">{cardsError}</p>}

          {!midRate ? (
            <p className="text-[10px] text-gold-dk">这个币种组合暂时没有参考汇率，换一组「我持有/目标币种」再看。</p>
          ) : allRows.length === 0 ? (
            <p className="text-[10px] text-gold-dk">
              自选渠道都取消勾选了，而且没有可比较的支付方式——去上面&ldquo;⚙自选渠道&rdquo;里勾几个看看。
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
                  <div className="mt-[3px] text-[9.5px] text-gold-dk">{row.note}</div>
                </li>
              ))}
            </ul>
          )}

          <p className="text-center text-[9px] text-gold-dk">
            渠道那组（Wise/TNG跨境/ATM取款/换钱店/支付宝）是固定参考表，不是实时拉取；「我的支付方式」那组用的是你自己配置的真实汇率加点+当日实时汇率——两组数据来源不同，精度不一样，不是同一套接口现查的。
          </p>
        </div>
      )}
    </section>
  );
}
