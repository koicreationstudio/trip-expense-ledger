'use client';

import { Check } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import type { FxRecommendationResult } from '@/lib/domain/fx-recommendation';

/**
 * 比价结果的排序渲染，从 expense-form.tsx 抽出来，跟独立的「当前汇率比价」
 * 卡片（fx-rate-card.tsx）共用，避免两处各写一套导致视觉/文案长歪。
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
  return (
    <div className="flex flex-col gap-2">
      {recommendations.map((r, index) => {
        const isBest = index === 0 && !r.unavailable;
        const isSelected = selectedPaymentMethodId === r.paymentMethodId;
        return (
          <button
            key={r.paymentMethodId}
            type="button"
            disabled={r.unavailable || !onSelect}
            onClick={() => onSelect?.(r.paymentMethodId)}
            className={`flex flex-col gap-1 rounded-xl border px-[9px] py-2 text-left disabled:cursor-not-allowed ${
              !onSelect ? '' : 'disabled:opacity-60'
            } ${isBest ? 'border-seafoam bg-sf-lt' : 'border-sand bg-[rgba(164,163,160,.14)]'} ${
              isSelected ? 'ring-2 ring-ink' : ''
            }`}
          >
            <span className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[12.5px] font-semibold">
                {r.label}
                {isBest && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-seafoam px-[9px] py-[3px] text-[9.5px] font-medium text-white">
                    <Check className="h-3 w-3" aria-hidden="true" />
                    最划算
                  </span>
                )}
              </span>
              <span className="font-serif text-sm font-medium tabular-nums">
                {r.unavailable || r.costInCompareCurrency === null
                  ? '缺汇率'
                  : formatMoney(r.costInCompareCurrency, compareCurrency)}
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
