'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { yuanToCents } from '@/lib/money';

export interface WalletOption {
  id: string;
  label: string;
  currency: string;
  emoji: string;
}

/**
 * 来源钱包允许不选（表示「纯充值无来源」，比如第一次登记带来的实体现金）。
 * 隐含汇率 = 目标金额 / 来源金额，不直接填汇率数字——两个真实金额比手动算好的
 * 汇率更不容易输错，这是照搬 remy-thailand 换汇表单的交互判断。
 */
export function ExchangeForm({ tripId, wallets }: { tripId: string; wallets: WalletOption[] }) {
  const router = useRouter();
  const [fromWalletId, setFromWalletId] = useState<string | null>(null);
  const [toWalletId, setToWalletId] = useState<string | null>(wallets[0]?.id ?? null);
  const [fromAmountYuan, setFromAmountYuan] = useState('');
  const [toAmountYuan, setToAmountYuan] = useState('');
  const [exchangeDate, setExchangeDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fromWallet = wallets.find((w) => w.id === fromWalletId) ?? null;
  const toWallet = wallets.find((w) => w.id === toWalletId) ?? null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!toWalletId) {
      setError('要选一个目标钱包');
      return;
    }
    const toAmount = Number(toAmountYuan);
    if (!toAmount || toAmount <= 0) {
      setError('目标金额要大于 0');
      return;
    }
    let fromAmount: number | undefined;
    if (fromWalletId) {
      fromAmount = Number(fromAmountYuan);
      if (!fromAmount || fromAmount <= 0) {
        setError('选了来源钱包就要填来源金额');
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/exchange-records`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fromWalletId: fromWalletId ?? undefined,
          toWalletId,
          fromAmount: fromAmount !== undefined ? yuanToCents(fromAmount) : undefined,
          toAmount: yuanToCents(toAmount),
          exchangeDate: new Date(exchangeDate).toISOString(),
          note: note.trim() || undefined,
        }),
      });
      if (!res.ok) {
        setError('保存失败，检查一下表单内容');
        return;
      }
      router.push(`/trips/${tripId}`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  if (wallets.length === 0) {
    return <p className="text-sm text-muted">先在行程主页新建至少一个钱包，才能记换汇。</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="field-label">从哪个钱包（不选＝纯充值，没有来源）</span>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setFromWalletId(null)}
            className={`h-11 rounded-xl border text-sm font-medium ${
              fromWalletId === null ? 'border-ink bg-ink text-paper' : 'border-sand'
            }`}
          >
            充值（无来源）
          </button>
          {wallets.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setFromWalletId(w.id)}
              className={`h-11 rounded-xl border text-sm font-medium ${
                fromWalletId === w.id ? 'border-ink bg-ink text-paper' : 'border-sand'
              }`}
            >
              {w.emoji} {w.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="field-label">充值到哪个钱包</span>
        <div className="grid grid-cols-2 gap-2">
          {wallets.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setToWalletId(w.id)}
              className={`h-11 rounded-xl border text-sm font-medium ${
                toWalletId === w.id ? 'border-ink bg-ink text-paper' : 'border-sand'
              }`}
            >
              {w.emoji} {w.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-end gap-2">
        {fromWalletId && (
          <>
            <div className="flex flex-1 flex-col gap-1">
              <label className="field-label" htmlFor="from-amount">
                来源金额（{fromWallet?.currency}）
              </label>
              <input
                id="from-amount"
                type="number"
                min="0.01"
                step="0.01"
                value={fromAmountYuan}
                onChange={(e) => setFromAmountYuan(e.target.value)}
                className="field-input font-serif text-lg"
                placeholder="0.00"
              />
            </div>
            <span className="pb-2.5 text-lg text-muted" aria-hidden="true">
              →
            </span>
          </>
        )}
        <div className="flex flex-1 flex-col gap-1">
          <label className="field-label" htmlFor="to-amount">
            目标金额（{toWallet?.currency}）
          </label>
          <input
            id="to-amount"
            type="number"
            min="0.01"
            step="0.01"
            value={toAmountYuan}
            onChange={(e) => setToAmountYuan(e.target.value)}
            className="field-input font-serif text-lg"
            placeholder="0.00"
          />
        </div>
      </div>

      {fromWalletId && Number(fromAmountYuan) > 0 && Number(toAmountYuan) > 0 && (
        <p className="text-sm text-muted">
          隐含汇率：1 {fromWallet?.currency} ≈ {(Number(toAmountYuan) / Number(fromAmountYuan)).toFixed(4)}{' '}
          {toWallet?.currency}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="field-label" htmlFor="exchange-date">
            日期
          </label>
          <input
            id="exchange-date"
            type="date"
            value={exchangeDate}
            onChange={(e) => setExchangeDate(e.target.value)}
            className="field-input"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="field-label" htmlFor="note">
            备注（可选）
          </label>
          <input
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="field-input"
            placeholder="比如：曼谷机场 ATM"
          />
        </div>
      </div>

      {error && <p className="text-base text-coral">{error}</p>}

      <button type="submit" disabled={submitting} className="btn-primary">
        {submitting ? '保存中…' : '保存充值记录'}
      </button>
    </form>
  );
}
