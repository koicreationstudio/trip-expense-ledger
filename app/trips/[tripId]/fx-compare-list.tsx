'use client';

import { formatMoney } from '@/lib/money';
import type { FxRecommendationResult } from '@/lib/domain/fx-recommendation';
import { findBestOfferIndex } from '@/lib/domain/fx-best-offer';

/**
 * 比价结果的排序渲染，从 expense-form.tsx 抽出来给"记一笔消费"表单的支付方式
 * 选择器用。2026-09-16 第十八轮：原本还跟行程主页的「当前汇率比价」卡片
 * （旧 fx-rate-card.tsx，这轮已经合并进 fx-compare-card.tsx 删掉了）共用这个
 * 渲染组件，合并后的新卡片自己重写了一套行内渲染（要跟渠道比价行混排统一排序，
 * 这个组件的展示结构不够用），现在这个文件只剩 expense-form.tsx 一处引用。
 */
export function FxCompareList({
  recommendations,
  compareCurrency,
  selectedPaymentMethodId,
  onSelect,
}: {
  recommendations: FxRecommendationResult[];
  compareCurrency: string;
  selectedPaymentMethodId?: string | null;
  onSelect?: (paymentMethodId: string) => void;
}) {
  // fix(2026-09-24 第五十八轮，Remy 真实反馈的真 bug"C")：同币种(无需换汇)的支付
  // 方式不该拿"✓最划算"徽章，即使它排序上因为数字最小排在第一——现金 1:1 无损
  // 跟真正经过汇率折算的方式不是同一个可比性质。`recommendations` 本来就按
  // costInCompareCurrency 升序排好（见 lib/domain/fx-recommendation.ts），所以
  // "第一个真正有资格的下标"就是该拿徽章的那一行。
  const firstEligibleIndex = findBestOfferIndex(recommendations);

  return (
    <div className="flex flex-col gap-2">
      {recommendations.map((r, index) => {
        const isBest = index === firstEligibleIndex;
        const isSelected = selectedPaymentMethodId === r.paymentMethodId;
        return (
          <button
            key={r.paymentMethodId}
            type="button"
            disabled={r.unavailable || !onSelect}
            onClick={() => onSelect?.(r.paymentMethodId)}
            className={`flex flex-col gap-1 rounded-xl border border-sand bg-[rgba(164,163,160,.14)] px-[9px] py-2 text-left disabled:cursor-not-allowed ${
              !onSelect ? '' : 'disabled:opacity-60'
            } ${isSelected ? 'ring-2 ring-ink' : ''}`}
          >
            <span className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold">
                {r.label}
                {isBest && (
                  <span className="ml-1.5 inline-flex items-center rounded-full bg-ok px-[7px] py-[1px] align-middle text-[8.5px] font-semibold text-white">
                    ✓最划算
                  </span>
                )}
              </span>
              <span className="text-sm font-medium">
                {r.unavailable || r.costInCompareCurrency === null ? (
                  '缺汇率'
                ) : (
                  <span className="font-serif tabular-nums">
                    {formatMoney(r.costInCompareCurrency, compareCurrency)}
                  </span>
                )}
              </span>
            </span>
            <span className="border-t border-dashed border-sand pt-1 text-[10px] text-muted">
              {r.unavailable || r.costInCompareCurrency === null
                ? '汇率缺失，建议手动核对'
                : r.requiresConversion
                  ? `汇率 ${r.effectiveRate?.toFixed(4) ?? '—'}`
                  : '同币种，无需换汇'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
