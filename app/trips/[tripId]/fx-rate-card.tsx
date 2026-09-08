'use client';

import { useState } from 'react';
import Link from 'next/link';
import { yuanToCents } from '@/lib/money';
import { FxCompareList } from './fx-compare-list';
import type { FxRecommendationResult } from '@/lib/domain/fx-recommendation';

/**
 * Remy 出差只去这四个国家，tab 固定这四种，不做成通用穷举列表——
 * 见 project_trip_expense_ledger_v01.md 第七轮范围确认。
 */
const DESTINATION_CURRENCIES = ['THB', 'HKD', 'SGD', 'LKR'] as const;

/**
 * 行程主页顶部的独立「当前汇率比价」区块，不需要先录一笔真实消费就能看——
 * 跟记账表单里那张比价卡调的是同一条 API/同一份支付方式配置，区别只是这里
 * 用一个可编辑的名义金额（默认 100）而不是一笔真实消费金额。
 */
export function FxRateCard({
  tripId,
  baseCurrency,
  hasPaymentMethods,
}: {
  tripId: string;
  baseCurrency: string;
  hasPaymentMethods: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [currency, setCurrency] = useState<string>(DESTINATION_CURRENCIES[0]);
  const [amountYuan, setAmountYuan] = useState('100');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<FxRecommendationResult[] | null>(null);

  async function loadRates(targetCurrency: string, forceRefresh: boolean) {
    const amount = Number(amountYuan);
    if (!amount || amount <= 0) {
      setError('金额要大于 0');
      setRecommendations(null);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/fx-recommendation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: yuanToCents(amount), expenseCurrency: targetCurrency, forceRefresh }),
      });
      if (!res.ok) {
        setError('比价失败，检查一下金额或网络');
        setRecommendations(null);
        return;
      }
      const data = (await res.json()) as { recommendations: FxRecommendationResult[] };
      setRecommendations(data.recommendations);
    } finally {
      setLoading(false);
    }
  }

  function handleToggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && recommendations === null && hasPaymentMethods) {
      void loadRates(currency, false);
    }
  }

  function handleSelectCurrency(next: string) {
    setCurrency(next);
    setRecommendations(null);
    if (hasPaymentMethods) void loadRates(next, false);
  }

  return (
    <section className="flex flex-col gap-3 rounded-[22px] border border-sand bg-paper p-4">
      <button type="button" onClick={handleToggle} className="flex items-center justify-between text-left">
        <span className="text-[12.5px] font-semibold text-slate-700">💱 当前汇率比价</span>
        <span className="text-[10px] text-muted">{expanded ? '收起 ▲' : '展开 ▼'}</span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {DESTINATION_CURRENCIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => handleSelectCurrency(c)}
                className={`rounded-full px-[9px] py-[3px] text-[11.5px] font-medium ${
                  currency === c ? 'bg-ink text-white' : 'bg-paper text-slate-600'
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <label className="field-label" htmlFor="fx-card-amount">
                名义金额（{currency}）
              </label>
              <input
                id="fx-card-amount"
                type="number"
                min="0.01"
                step="0.01"
                value={amountYuan}
                onChange={(e) => setAmountYuan(e.target.value)}
                onBlur={() => hasPaymentMethods && loadRates(currency, false)}
                className="field-input w-28 font-serif tabular-nums"
              />
            </div>
            <button
              type="button"
              onClick={() => loadRates(currency, true)}
              disabled={loading || !hasPaymentMethods}
              className="btn-secondary"
            >
              {loading ? '刷新中…' : '🔄 刷新'}
            </button>
          </div>

          {!hasPaymentMethods && (
            <p className="text-xs text-muted">
              先去{' '}
              <Link href={`/trips/${tripId}/payment-methods`} className="tap-link">
                支付方式设置
              </Link>{' '}
              加几张卡/现金，才能看比价。
            </p>
          )}

          {error && <p className="text-sm text-coral">{error}</p>}

          {hasPaymentMethods && recommendations && (
            <FxCompareList recommendations={recommendations} compareCurrency={baseCurrency} />
          )}
        </div>
      )}
    </section>
  );
}
