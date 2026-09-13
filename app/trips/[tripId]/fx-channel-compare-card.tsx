'use client';

import { useState } from 'react';

/**
 * "换汇渠道比价"——2026-09-13 落地 Artifact Version 10（第四轮拍板）。跟同一屏已有的
 * FxRateCard 是两个不同维度的比较，不是替换关系：FxRateCard 答的是"这笔钱该用我配置
 * 的哪张卡/现金付"，这个卡片答的是"要把钱换成外币，走哪个渠道换划算"（Wise/TNG跨境/
 * ATM取款/换钱店/支付宝），数据是 Artifact 给的固定汇率表+渠道点差，纯前端算，不接
 * 任何后端 API（这几个数字本来就是静态参考值，不是拉汇率 API 现算）。
 *
 * 这是全新增量功能，优先级排在这轮改动里较低档（brief 原话），先做出一个基本能用的
 * 版本：目标币种下拉切换真的重算数字，渠道自选（含支付宝独立开关）真的增减对比列表。
 */
const FX_RATES: Record<string, Record<string, number>> = {
  MYR: { THB: 8.12, USD: 0.245, SGD: 0.318, CNY: 1.61, HKD: 1.92 },
  USD: { THB: 33.03, MYR: 4.08, SGD: 1.3, CNY: 6.58, HKD: 7.82 },
};

const FX_SYMBOLS: Record<string, string> = { THB: '฿', USD: '$', SGD: 'S$', CNY: '¥', HKD: 'HK$' };

interface FxChannel {
  name: string;
  spread: number;
  best?: boolean;
  note: string;
  isAlipay?: boolean;
}

const FX_CHANNELS: FxChannel[] = [
  { name: 'Wise', spread: -0.00714, best: true, note: '接近中间价 · 约 0.7% 手续费' },
  { name: 'TNG 跨境', spread: -0.01515, note: 'DuitNow 跨境 · 约 -1.5%' },
  { name: 'ATM 取款', spread: -0.02217, note: '银行外汇费约 2% + ฿220 固定手续费' },
  { name: '换钱店', spread: -0.02512, note: '市区 Superrich · 约 -2.5%，机场更差' },
  // 支付宝的实际点差 Artifact 没给具体数字，这里先按同量级估一个 -1.8%（介于 TNG 跨境
  // 和 ATM 取款之间），等 Remy 有真实数据再更新——不是权威值，只是让这个渠道能出现在
  // 对比列表里，UI 上也标了「估算」两个字，不假装是准的。
  { name: '支付宝', spread: -0.018, note: '约 -1.8%（估算值，待真实数据更新）', isAlipay: true },
];

// ATM 取款固定手续费本来是按泰铢 220 定的（写死 ฿220），但目标币种一切换（比如切到
// SGD），文案还留着泰铢符号，数字跟当前选的币种对不上——ui-auditor 走查发现的问题。
// FX_RATES.MYR 这张表最全（THB/USD/SGD/CNY/HKD 都有，都是「1 MYR 能换多少目标币种」），
// 拿它当枢纽：先把 220 THB 换成 MYR，再换成目标币种，MYR 自己是枢纽就不用再查表。
// 精度上不用较真到小数点后很多位，够小的数（<100）留 1 位小数，够大的数四舍五入到整数。
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

/**
 * "我持有"基准 + "换成"目标的候选清单，原本是写死 Object.keys(FX_RATES)（固定只有
 * MYR/USD 两个基准可选）。2026-09-13 这轮改成读行程的 enabledCurrencies——新建行程页
 * 那个"同时启用哪些币种"多选，存进数据库后从没被任何组件真的读过，这里接上。
 *
 * FX_RATES 本身只覆盖 MYR/USD 这两个基准（汇率数值来源，不是这次改动范围），所以候选
 * 清单永远是 enabledCurrencies 跟 FX_RATES 有数据的币种取交集，不是 enabledCurrencies
 * 原样铺开——启用了 FX_RATES 没有汇率的币种（比如 PHP/LKR）不会出现在这张卡里，避免
 * 选了却查不到数字。enabledCurrencies 是 null（老行程没设置过这个字段）时按 schema
 * 注释里"视为不做币种收窄"，退回旧行为（MYR/USD 都能选）。
 */
function resolveBaseCandidates(enabledCurrencies: string[] | null): string[] {
  const allBases = Object.keys(FX_RATES);
  if (!enabledCurrencies || enabledCurrencies.length === 0) return allBases;
  return allBases.filter((b) => enabledCurrencies.includes(b));
}

/** 目标候选：FX_RATES[base] 的 key 里，剔除 base 自己（不能选自己换算自己），
 * 再跟 enabledCurrencies 取交集（null/空数组同上视为不收窄）。 */
function resolveTargetCandidates(base: string, enabledCurrencies: string[] | null): string[] {
  const keys = Object.keys(FX_RATES[base] ?? {}).filter((c) => c !== base);
  if (!enabledCurrencies || enabledCurrencies.length === 0) return keys;
  return keys.filter((c) => enabledCurrencies.includes(c));
}

export function FxChannelCompareCard({ enabledCurrencies }: { enabledCurrencies: string[] | null }) {
  const [expanded, setExpanded] = useState(false);
  const [baseCurrency, setBaseCurrency] = useState<string>('MYR');
  const [targetCurrency, setTargetCurrency] = useState<string>('THB');
  const [amountYuan, setAmountYuan] = useState('1000');
  const [alipayEnabled, setAlipayEnabled] = useState(true);

  const baseCandidates = resolveBaseCandidates(enabledCurrencies);
  // 用户手动选的 baseCurrency 如果不在这趟行程的候选里了（比如切换到只启用了 USD 的
  // 行程），退回候选清单里第一个，而不是硬显示一个选不了的值；候选清单本身可能是空的
  // （见下面 hasUsableBase/hasUsableTarget），兜底空字符串只是让 TS 类型是 string 而不是
  // string | undefined，实际渲染时空清单会走空状态分支，不会真的拿空字符串去查表。
  const effectiveBase = baseCandidates.includes(baseCurrency) ? baseCurrency : baseCandidates[0] ?? '';
  const targetCandidates = effectiveBase ? resolveTargetCandidates(effectiveBase, enabledCurrencies) : [];
  const effectiveTarget = targetCandidates.includes(targetCurrency) ? targetCurrency : targetCandidates[0] ?? '';

  const hasUsableBase = baseCandidates.length > 0;
  const hasUsableTarget = targetCandidates.length > 0;

  const midRate = effectiveBase && effectiveTarget ? FX_RATES[effectiveBase]?.[effectiveTarget] : undefined;
  const amount = Number(amountYuan) || 0;
  const visibleChannels = FX_CHANNELS.filter((c) => alipayEnabled || !c.isAlipay);

  return (
    <section className="flex flex-col gap-3 rounded-hero border border-sand bg-paper p-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-between text-left"
      >
        <span className="text-[12.5px] font-semibold text-ink">🔀 换汇渠道比价</span>
        <span className="text-[10px] text-muted">{expanded ? '收起 ▲' : '展开 ▼'}</span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-3">
          {!hasUsableBase ? (
            // 行程启用的币种里，一个都不在 FX_RATES 支持的基准里（目前只有 MYR/USD 两档）
            // ——比如这趟行程只勾了 THB/PHP，没勾 MYR 也没勾 USD。给个说明而不是空白/报错。
            <p className="text-[10px] text-muted">
              这趟行程启用的币种里没有可以当基准的（目前渠道比价只支持 MYR / USD 作基准），去「新建行程」的币种设置里加一个再回来看。
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <label className="field-label" htmlFor="fx-channel-base">
                    我持有
                  </label>
                  <select
                    id="fx-channel-base"
                    value={effectiveBase}
                    onChange={(e) => setBaseCurrency(e.target.value)}
                    className="field-input"
                  >
                    {baseCandidates.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="field-label" htmlFor="fx-channel-amount">
                    金额
                  </label>
                  <input
                    id="fx-channel-amount"
                    type="number"
                    min="0"
                    step="1"
                    value={amountYuan}
                    onChange={(e) => setAmountYuan(e.target.value)}
                    className="field-input w-24 font-serif tabular-nums"
                  />
                </div>
              </div>

              {!hasUsableTarget ? (
                // 行程只启用了 1 种币种（或启用的其它币种都不在这个基准的 FX_RATES 表里），
                // 没有别的币种可比——不报错也不留空白，说清楚原因。
                <p className="text-[10px] text-muted">
                  这趟行程目前启用的币种里，没有其他能跟 {effectiveBase} 比价的目标币种，去「新建行程」的币种设置里多勾一个再回来看。
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    {targetCandidates.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setTargetCurrency(c)}
                        className={`min-h-[26px] rounded-full px-[9px] py-[3px] font-mono text-[10px] font-medium ${
                          effectiveTarget === c ? 'bg-ink text-white' : 'bg-paper text-muted'
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>

                  <label className="flex items-center gap-1.5 text-[10px] text-muted">
                    <input
                      type="checkbox"
                      checked={alipayEnabled}
                      onChange={(e) => setAlipayEnabled(e.target.checked)}
                    />
                    包含支付宝渠道
                  </label>

                  {midRate === undefined ? (
                    <p className="text-[10px] text-muted">这个币种组合暂时没有参考汇率。</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {visibleChannels
                        .map((c) => ({
                          ...c,
                          effectiveRate: midRate * (1 + c.spread),
                          note: c.name === 'ATM 取款' ? formatAtmFeeNote(effectiveTarget) : c.note,
                        }))
                        .sort((a, b) => b.effectiveRate - a.effectiveRate)
                        .map((c) => (
                          <li
                            key={c.name}
                            className={`flex items-center justify-between gap-2 rounded-xl border px-[9px] py-[5px] text-[10.5px] ${
                              c.best ? 'border-ok bg-ok-bg' : 'border-sand bg-[rgba(164,163,160,.14)]'
                            }`}
                          >
                            <div className="flex flex-col">
                              <span className="font-medium">{c.name}</span>
                              <span className="text-[9px] text-muted">{c.note}</span>
                            </div>
                            <span className="font-serif tabular-nums">
                              {FX_SYMBOLS[effectiveTarget] ?? ''}
                              {(amount * c.effectiveRate).toFixed(2)}
                            </span>
                          </li>
                        ))}
                    </ul>
                  )}
                </>
              )}
            </>
          )}
          <p className="text-[9px] text-muted">
            参考汇率是固定表，不是实时拉取；跟上面「当前汇率比价」比的是不同东西——那个比的是刷卡该用哪张卡，这个比的是换钱走哪个渠道。
          </p>
        </div>
      )}
    </section>
  );
}
