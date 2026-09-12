'use client';

import { useEffect, useState } from 'react';
import { PAYMENT_METHOD_SETTLEMENT_CURRENCIES } from '@/lib/currencies';
import { yuanToCents, formatMoney } from '@/lib/money';
import { ConfirmDialog } from '@/components/confirm-dialog';

interface PaymentMethod {
  id: string;
  label: string;
  kind: 'card' | 'cash';
  settlementCurrency: string;
  fxMarkupPercent: number;
  foreignTxnFeePercent: number;
  fixedFee: number;
  cashbackPercent: number;
  isActive: boolean;
  sortOrder: number;
}

const emptyForm = {
  label: '',
  kind: 'card' as 'card' | 'cash',
  settlementCurrency: PAYMENT_METHOD_SETTLEMENT_CURRENCIES[0] as string,
  fxMarkupPercent: '0',
  foreignTxnFeePercent: '0',
  fixedFeeYuan: '0',
  cashbackPercent: '0',
};

export function PaymentMethodsManager() {
  const [methods, setMethods] = useState<PaymentMethod[] | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function loadMethods() {
    const res = await fetch('/api/payment-methods');
    if (res.ok) {
      const data = (await res.json()) as any;
      setMethods(data.paymentMethods);
    }
  }

  useEffect(() => {
    loadMethods();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.label.trim()) {
      setError('名称不能空着');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/payment-methods', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label: form.label.trim(),
          kind: form.kind,
          settlementCurrency: form.settlementCurrency,
          fxMarkupPercent: Number(form.fxMarkupPercent) || 0,
          foreignTxnFeePercent: Number(form.foreignTxnFeePercent) || 0,
          fixedFee: yuanToCents(Number(form.fixedFeeYuan) || 0),
          cashbackPercent: Number(form.cashbackPercent) || 0,
        }),
      });
      if (!res.ok) {
        setError('添加失败，检查一下表单内容');
        return;
      }
      setForm(emptyForm);
      await loadMethods();
    } finally {
      setSubmitting(false);
    }
  }

  async function performDelete(id: string) {
    setConfirmingId(null);
    await fetch(`/api/payment-methods/${id}`, { method: 'DELETE' });
    await loadMethods();
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h2 className="text-[12.5px] font-semibold text-ink">已配置的支付方式</h2>
        {methods === null ? (
          <p className="text-xs text-muted">载入中…</p>
        ) : methods.length === 0 ? (
          <p className="text-xs text-muted">还没配置任何支付方式。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {methods.map((m) => (
              <li key={m.id} className="tx-item justify-between">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-circle text-sm"
                    aria-hidden="true"
                  >
                    {m.kind === 'card' ? '💳' : '💵'}
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-[12.5px] font-medium">
                      {m.label}（{m.kind === 'card' ? '卡' : '现金'} · {m.settlementCurrency}）
                    </span>
                    <span className="mt-0.5 border-t border-dashed border-sand pt-1 text-[10px] text-muted">
                      汇率加点 {m.fxMarkupPercent}% · 境外手续费 {m.foreignTxnFeePercent}% · 返现 {m.cashbackPercent}%
                      {m.fixedFee > 0 && (
                        <>
                          {' · 固定费 '}
                          <span className="font-serif tabular-nums">
                            {formatMoney(m.fixedFee, m.settlementCurrency)}
                          </span>
                        </>
                      )}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmingId(m.id)}
                  className="btn-secondary shrink-0"
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[12.5px] font-semibold text-ink">新增支付方式</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="field-label" htmlFor="pm-label">
                名称
              </label>
              <input
                id="pm-label"
                required
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="例如：HSBC 万事达卡"
                className="field-input"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="field-label" htmlFor="pm-kind">
                类型
              </label>
              <select
                id="pm-kind"
                value={form.kind}
                onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as 'card' | 'cash' }))}
                className="field-input"
              >
                <option value="card">卡</option>
                <option value="cash">现金</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="field-label" htmlFor="pm-currency">
              结算币种
            </label>
            <select
              id="pm-currency"
              value={form.settlementCurrency}
              onChange={(e) => setForm((f) => ({ ...f, settlementCurrency: e.target.value }))}
              className="field-input"
            >
              {PAYMENT_METHOD_SETTLEMENT_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="field-label" htmlFor="pm-fx-markup">
                汇率加点 %
              </label>
              <input
                id="pm-fx-markup"
                type="number"
                step="0.01"
                min="0"
                value={form.fxMarkupPercent}
                onChange={(e) => setForm((f) => ({ ...f, fxMarkupPercent: e.target.value }))}
                className="field-input"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="field-label" htmlFor="pm-foreign-fee">
                境外手续费 %
              </label>
              <input
                id="pm-foreign-fee"
                type="number"
                step="0.01"
                min="0"
                value={form.foreignTxnFeePercent}
                onChange={(e) => setForm((f) => ({ ...f, foreignTxnFeePercent: e.target.value }))}
                className="field-input"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="field-label" htmlFor="pm-fixed-fee">
                固定费（结算币种，元）
              </label>
              <input
                id="pm-fixed-fee"
                type="number"
                step="0.01"
                min="0"
                value={form.fixedFeeYuan}
                onChange={(e) => setForm((f) => ({ ...f, fixedFeeYuan: e.target.value }))}
                className="field-input"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="field-label" htmlFor="pm-cashback">
                返现 %
              </label>
              <input
                id="pm-cashback"
                type="number"
                step="0.01"
                min="0"
                value={form.cashbackPercent}
                onChange={(e) => setForm((f) => ({ ...f, cashbackPercent: e.target.value }))}
                className="field-input"
              />
            </div>
          </div>

          {error && <p className="text-sm text-coral">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="btn-primary"
          >
            {submitting ? '添加中…' : '添加支付方式'}
          </button>
        </form>
      </section>
      <ConfirmDialog
        open={confirmingId !== null}
        message="确定要删除这个支付方式吗？"
        confirmLabel="删除"
        onConfirm={() => confirmingId && performDelete(confirmingId)}
        onCancel={() => setConfirmingId(null)}
      />
    </div>
  );
}
