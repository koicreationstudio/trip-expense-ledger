'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { COMMON_CURRENCIES } from '@/lib/currencies';
import { yuanToCents, centsToYuan, formatMoney } from '@/lib/money';
import { equalSplit, rescaleSplitToBaseCurrency } from '@/lib/domain/split';
import type { SplitShare } from '@/lib/domain/split';
import type { FxRecommendationResult } from '@/lib/domain/fx-recommendation';

const COMMON_CATEGORIES = ['餐饮', '交通', '住宿', '门票', '购物', '其他'];

interface Participant {
  id: string;
  displayName: string;
}

export interface InitialExpense {
  id: string;
  amount: number; // 原始币种最小货币单位
  currency: string;
  payerParticipantId: string;
  category: string;
  note: string | null;
  expenseDate: string; // ISO
  fxRateUsed: number;
  amountBaseCurrency: number;
  hasReceipt: boolean;
  splits: SplitShare[];
}

/**
 * 编辑一笔已有消费时，从数据库存的 splits（本位币金额）反推表单要用的原生币种
 * 分摊金额和是否为「自定义分摊」——DB 只存本位币份额，不存用户当初输入的原生
 * 币种拆法，这里按这笔消费自己的 amount/amountBaseCurrency 比例换算回去，只作
 * 初始展示值，可能有几分钱的舍入误差；真正提交时会用 rescaleSplitToBaseCurrency
 * 重新精确换算，不依赖这里的结果。
 */
function deriveInitialSplitState(initialExpense: InitialExpense, participants: Participant[]) {
  const allIds = participants.map((p) => p.id);
  const equalShares = equalSplit(initialExpense.amountBaseCurrency, allIds);
  const equalMap = new Map(equalShares.map((s) => [s.participantId, s.shareAmountBaseCurrency]));
  const isDefaultEqualSplit =
    initialExpense.splits.length === allIds.length &&
    initialExpense.splits.every((s) => equalMap.get(s.participantId) === s.shareAmountBaseCurrency);

  if (isDefaultEqualSplit) {
    return {
      customSplit: false,
      splitIncluded: Object.fromEntries(allIds.map((id) => [id, true])),
      splitAmounts: {} as Record<string, string>,
    };
  }

  const splitByParticipant = new Map(initialExpense.splits.map((s) => [s.participantId, s.shareAmountBaseCurrency]));
  const splitIncluded = Object.fromEntries(allIds.map((id) => [id, splitByParticipant.has(id)]));
  const splitAmounts = Object.fromEntries(
    initialExpense.splits.map((s) => {
      const nativeCents =
        initialExpense.amountBaseCurrency === 0
          ? 0
          : Math.round((s.shareAmountBaseCurrency * initialExpense.amount) / initialExpense.amountBaseCurrency);
      return [s.participantId, String(centsToYuan(nativeCents))];
    })
  );

  return { customSplit: true, splitIncluded, splitAmounts };
}

export function ExpenseForm({
  tripId,
  baseCurrency,
  myParticipantId,
  participants,
  initialExpense,
}: {
  tripId: string;
  baseCurrency: string;
  myParticipantId: string;
  participants: Participant[];
  initialExpense?: InitialExpense;
}) {
  const router = useRouter();
  const isEdit = initialExpense !== undefined;
  const initialSplitState = initialExpense ? deriveInitialSplitState(initialExpense, participants) : null;

  const [amountYuan, setAmountYuan] = useState(initialExpense ? String(centsToYuan(initialExpense.amount)) : '');
  const [currency, setCurrency] = useState(initialExpense?.currency ?? baseCurrency);
  const [payerParticipantId, setPayerParticipantId] = useState(initialExpense?.payerParticipantId ?? myParticipantId);
  const [category, setCategory] = useState(initialExpense?.category ?? '');
  const [expenseDate, setExpenseDate] = useState(
    initialExpense ? initialExpense.expenseDate.slice(0, 10) : new Date().toISOString().slice(0, 10)
  );
  const [note, setNote] = useState(initialExpense?.note ?? '');
  const [fxRateUsed, setFxRateUsed] = useState(
    initialExpense && initialExpense.fxRateUsed !== 1 ? String(initialExpense.fxRateUsed) : ''
  );
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [comparing, setComparing] = useState(false);
  const [recommendations, setRecommendations] = useState<FxRecommendationResult[] | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);

  const [customSplit, setCustomSplit] = useState(initialSplitState?.customSplit ?? false);
  const [splitIncluded, setSplitIncluded] = useState<Record<string, boolean>>(
    initialSplitState?.splitIncluded ?? Object.fromEntries(participants.map((p) => [p.id, true]))
  );
  const [splitAmounts, setSplitAmounts] = useState<Record<string, string>>(initialSplitState?.splitAmounts ?? {});

  const needsManualFxRate = currency !== baseCurrency;

  const amountCentsTotal = yuanToCents(Number(amountYuan) || 0);
  const includedParticipants = participants.filter((p) => splitIncluded[p.id]);
  const splitCentsTotal = includedParticipants.reduce(
    (sum, p) => sum + yuanToCents(Number(splitAmounts[p.id]) || 0),
    0
  );
  const splitMismatch = customSplit && splitCentsTotal !== amountCentsTotal;

  function handleEqualizeSplit() {
    if (includedParticipants.length === 0) return;
    const shares = equalSplit(amountCentsTotal, includedParticipants.map((p) => p.id));
    setSplitAmounts((prev) => {
      const next = { ...prev };
      for (const s of shares) {
        next[s.participantId] = String(centsToYuan(s.shareAmountBaseCurrency));
      }
      return next;
    });
  }

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
        const body = await (res.json() as Promise<any>).catch(() => null);
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
      const data = (await res.json()) as any;
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

    const amountCents = yuanToCents(amount);
    const amountBaseCurrency = needsManualFxRate ? Math.round(amountCents * Number(fxRateUsed)) : amountCents;

    let splits: SplitShare[] | undefined;

    if (customSplit) {
      const included = participants.filter((p) => splitIncluded[p.id]);
      if (included.length === 0) {
        setError('自定义分摊至少要选一个人');
        return;
      }
      const nativeShares = included.map((p) => ({
        participantId: p.id,
        amountNativeCents: yuanToCents(Number(splitAmounts[p.id]) || 0),
      }));
      const nativeSum = nativeShares.reduce((sum, s) => sum + s.amountNativeCents, 0);
      if (nativeSum !== amountCents) {
        setError('自定义分摊金额总和要等于消费总金额');
        return;
      }
      splits = rescaleSplitToBaseCurrency(nativeShares, amountBaseCurrency);
    } else if (isEdit) {
      // 编辑时金额/币种字段一定会被重传，PATCH 要求「金额一变就必须同时带 splits」，
      // 这里补上默认等分，跟创建时后端自己算的默认行为保持一致。
      splits = equalSplit(amountBaseCurrency, participants.map((p) => p.id));
    }

    setSubmitting(true);
    try {
      const endpoint = isEdit
        ? `/api/trips/${tripId}/expenses/${initialExpense.id}`
        : `/api/trips/${tripId}/expenses`;

      const res = await fetch(endpoint, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          payerParticipantId,
          amount: amountCents,
          currency,
          fxRateUsed: needsManualFxRate ? Number(fxRateUsed) : undefined,
          category: category.trim(),
          note: note.trim() || undefined,
          expenseDate: new Date(expenseDate).toISOString(),
          splits,
        }),
      });

      if (!res.ok) {
        setError('提交失败，检查一下表单内容');
        return;
      }

      const expenseId = isEdit ? initialExpense.id : ((await res.json()) as any).expense.id;

      if (receiptFile) {
        const form = new FormData();
        form.append('file', receiptFile);
        await fetch(`/api/expenses/${expenseId}/receipt`, { method: 'POST', body: form });
      }

      router.push(`/trips/${tripId}`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="field-label" htmlFor="amount">
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
            placeholder="0.00"
            className="field-input text-lg font-semibold tabular-nums"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="field-label" htmlFor="currency">
            币种
          </label>
          <select
            id="currency"
            value={currency}
            onChange={(e) => {
              setCurrency(e.target.value);
              setRecommendations(null);
            }}
            className="field-input"
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
          <label className="field-label" htmlFor="fx-rate">
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
            className="field-input"
          />
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between">
          <span className="field-label">这笔用哪张卡最划算？</span>
          <button
            type="button"
            onClick={handleCompare}
            disabled={comparing}
            className="btn-secondary"
          >
            {comparing ? '比价中…' : '比价'}
          </button>
        </div>
        {compareError === 'no_payment_methods' && (
          <p className="text-sm text-slate-500">
            还没配置支付方式，先去{' '}
            <Link href={`/trips/${tripId}/payment-methods`} className="tap-link">
              支付方式设置
            </Link>{' '}
            配一下。
          </p>
        )}
        {compareError && compareError !== 'no_payment_methods' && (
          <p className="text-base text-red-600">{compareError}</p>
        )}
        {recommendations && (
          <ul className="flex flex-col gap-1">
            {recommendations.map((r, index) => (
              <li
                key={r.paymentMethodId}
                className={`flex items-center justify-between rounded px-2 py-1 text-base ${
                  index === 0 && !r.unavailable ? 'bg-emerald-50 text-emerald-800' : ''
                }`}
              >
                <span className="flex items-center gap-2">
                  {r.label}
                  {index === 0 && !r.unavailable && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white">
                      <Check className="h-3 w-3" aria-hidden="true" />
                      最划算
                    </span>
                  )}
                </span>
                <span className="tabular-nums">
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
        <label className="field-label" htmlFor="payer">
          谁代垫的
        </label>
        <select
          id="payer"
          value={payerParticipantId}
          onChange={(e) => setPayerParticipantId(e.target.value)}
          className="field-input"
        >
          {participants.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="field-label" htmlFor="category">
          分类
        </label>
        <input
          id="category"
          list="category-options"
          required
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="例如：餐饮"
          className="field-input"
        />
        <datalist id="category-options">
          {COMMON_CATEGORIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>

      <div className="flex flex-col gap-1">
        <label className="field-label" htmlFor="expense-date">
          日期
        </label>
        <input
          id="expense-date"
          type="date"
          required
          value={expenseDate}
          onChange={(e) => setExpenseDate(e.target.value)}
          className="field-input"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="field-label" htmlFor="note">
          备注（可选）
        </label>
        <textarea
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="field-input"
          rows={2}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="field-label" htmlFor="receipt">
          收据（可选{isEdit && initialExpense.hasReceipt ? '，已有收据，上传新文件会替换' : ''}）
        </label>
        <input
          id="receipt"
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.pdf"
          onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-3">
        <label className="flex items-center gap-2 text-base font-medium">
          <input
            type="checkbox"
            checked={customSplit}
            onChange={(e) => setCustomSplit(e.target.checked)}
          />
          自定义分摊（不勾选默认全员等分）
        </label>

        {!customSplit && <p className="text-xs text-slate-500">默认所有参与者平均分摊这笔消费。</p>}

        {customSplit && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              {participants.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={splitIncluded[p.id] ?? true}
                    onChange={(e) =>
                      setSplitIncluded((prev) => ({ ...prev, [p.id]: e.target.checked }))
                    }
                  />
                  <span className="w-24 shrink-0 text-base">{p.displayName}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={!(splitIncluded[p.id] ?? true)}
                    value={splitAmounts[p.id] ?? ''}
                    onChange={(e) =>
                      setSplitAmounts((prev) => ({ ...prev, [p.id]: e.target.value }))
                    }
                    placeholder="0.00"
                    className="field-input w-28"
                  />
                  <span className="text-xs text-slate-500">{currency}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleEqualizeSplit}
                className="btn-secondary shrink-0 whitespace-nowrap"
              >
                平均分给已勾选的人
              </button>
              <span className={`text-sm tabular-nums ${splitMismatch ? 'text-red-600' : 'text-emerald-700'}`}>
                已分配 {formatMoney(splitCentsTotal, currency)} / 共 {formatMoney(amountCentsTotal, currency)}
              </span>
            </div>
            {splitMismatch && (
              <p className="text-base text-red-600">分摊总和要跟消费总金额完全一致才能提交。</p>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-base text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting || splitMismatch}
          className="btn-primary"
        >
          {submitting ? '保存中…' : isEdit ? '保存修改' : '记这笔账'}
        </button>
        {isEdit && (
          <Link href={`/trips/${tripId}`} className="tap-link text-slate-500">
            取消
          </Link>
        )}
      </div>
    </form>
  );
}
