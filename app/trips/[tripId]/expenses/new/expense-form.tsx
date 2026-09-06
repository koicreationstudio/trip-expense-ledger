'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { COMMON_CURRENCIES } from '@/lib/currencies';
import { yuanToCents, formatMoney } from '@/lib/money';
import type { FxRecommendationResult } from '@/lib/domain/fx-recommendation';

const COMMON_CATEGORIES = ['餐饮', '交通', '住宿', '门票', '购物', '其他'];

interface Participant {
  id: string;
  displayName: string;
}

export function ExpenseForm({
  tripId,
  baseCurrency,
  myParticipantId,
  participants,
}: {
  tripId: string;
  baseCurrency: string;
  myParticipantId: string;
  participants: Participant[];
}) {
  const router = useRouter();
  const [amountYuan, setAmountYuan] = useState('');
  const [currency, setCurrency] = useState(baseCurrency);
  const [payerParticipantId, setPayerParticipantId] = useState(myParticipantId);
  const [category, setCategory] = useState('');
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [fxRateUsed, setFxRateUsed] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [comparing, setComparing] = useState(false);
  const [recommendations, setRecommendations] = useState<FxRecommendationResult[] | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);

  const needsManualFxRate = currency !== baseCurrency;

  async function handleCompare() {
    setCompareError(null);
    setRecommendations(null);
    const amount = Number(amountYuan);
    if (!amount || amount <= 0) {
      setCompareError('先填金额再比价');
      return;
    }
    setComparing(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/fx-recommendation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: yuanToCents(amount), expenseCurrency: currency }),
      });
      if (res.status === 400) {
        const body = await res.json().catch(() => null);
        if (body?.error === 'no_payment_methods') {
          setCompareError('no_payment_methods');
          return;
        }
        setCompareError('比价失败，检查一下金额/币种');
        return;
      }
      if (!res.ok) {
        setCompareError('比价失败，检查一下金额/币种');
        return;
      }
      const data = await res.json();
      setRecommendations(data.recommendations);
    } finally {
      setComparing(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const amount = Number(amountYuan);
    if (!amount || amount <= 0) {
      setError('金额要大于 0');
      return;
    }
    if (needsManualFxRate && !fxRateUsed) {
      setError(`币种不是本位币 ${baseCurrency}，要填汇率（1 ${currency} = 多少 ${baseCurrency}）`);
      return;
    }
    if (!category.trim()) {
      setError('分类不能空着');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/expenses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          payerParticipantId,
          amount: yuanToCents(amount),
          currency,
          fxRateUsed: needsManualFxRate ? Number(fxRateUsed) : undefined,
          category: category.trim(),
          note: note.trim() || undefined,
          expenseDate: new Date(expenseDate).toISOString(),
        }),
      });

      if (!res.ok) {
        setError('提交失败，检查一下表单内容');
        return;
      }

      const data = await res.json();

      if (receiptFile) {
        const form = new FormData();
        form.append('file', receiptFile);
        await fetch(`/api/expenses/${data.expense.id}/receipt`, { method: 'POST', body: form });
      }

      router.push(`/trips/${tripId}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="amount">
            金额
          </label>
          <input
            id="amount"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={amountYuan}
            onChange={(e) => setAmountYuan(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="currency">
            币种
          </label>
          <select
            id="currency"
            value={currency}
            onChange={(e) => {
              setCurrency(e.target.value);
              setRecommendations(null);
            }}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {Array.from(new Set([baseCurrency, ...COMMON_CURRENCIES])).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {needsManualFxRate && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="fx-rate">
            汇率（1 {currency} = 多少 {baseCurrency}）
          </label>
          <input
            id="fx-rate"
            type="number"
            min="0"
            step="0.0001"
            value={fxRateUsed}
            onChange={(e) => setFxRateUsed(e.target.value)}
            placeholder="手动输入，比价拉不到当日汇率也不影响记账"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">这笔用哪张卡最划算？</span>
          <button
            type="button"
            onClick={handleCompare}
            disabled={comparing}
            className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-100 disabled:opacity-50"
          >
            {comparing ? '比价中…' : '比价'}
          </button>
        </div>
        {compareError === 'no_payment_methods' && (
          <p className="text-xs text-slate-500">
            还没配置支付方式，先去{' '}
            <Link href={`/trips/${tripId}/payment-methods`} className="underline">
              支付方式设置
            </Link>{' '}
            配一下。
          </p>
        )}
        {compareError && compareError !== 'no_payment_methods' && (
          <p className="text-xs text-red-600">{compareError}</p>
        )}
        {recommendations && (
          <ul className="flex flex-col gap-1">
            {recommendations.map((r, index) => (
              <li
                key={r.paymentMethodId}
                className={`flex items-center justify-between rounded px-2 py-1 text-sm ${
                  index === 0 && !r.unavailable ? 'bg-emerald-50 text-emerald-800' : ''
                }`}
              >
                <span>
                  {r.label}
                  {index === 0 && !r.unavailable && <span className="ml-2 text-xs">最划算</span>}
                </span>
                <span>
                  {r.unavailable || r.costInCompareCurrency === null
                    ? '汇率缺失，建议手动核对'
                    : formatMoney(r.costInCompareCurrency, baseCurrency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="payer">
          谁代垫的
        </label>
        <select
          id="payer"
          value={payerParticipantId}
          onChange={(e) => setPayerParticipantId(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          {participants.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="category">
          分类
        </label>
        <input
          id="category"
          list="category-options"
          required
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="例如：餐饮"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <datalist id="category-options">
          {COMMON_CATEGORIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="expense-date">
          日期
        </label>
        <input
          id="expense-date"
          type="date"
          required
          value={expenseDate}
          onChange={(e) => setExpenseDate(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="note">
          备注（可选）
        </label>
        <textarea
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          rows={2}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="receipt">
          收据（可选）
        </label>
        <input
          id="receipt"
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.pdf"
          onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
      </div>

      <p className="text-xs text-slate-500">默认所有参与者平均分摊这笔消费。</p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {submitting ? '提交中…' : '记这笔账'}
      </button>
    </form>
  );
}
