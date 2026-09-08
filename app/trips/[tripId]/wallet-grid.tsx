'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { COMMON_CURRENCIES } from '@/lib/currencies';
import { yuanToCents, formatMoney } from '@/lib/money';

export interface WalletItem {
  id: string;
  label: string;
  currency: string;
  emoji: string;
  currentBalance: number;
  paymentMethodId: string | null;
  linkedPaymentMethodLabel: string | null;
}

export interface WalletPaymentMethodOption {
  id: string;
  label: string;
  settlementCurrency: string;
}

const EMOJI_CHOICES = ['🏦', '💵', '🌐', '📱', '🟠', '💳', '💰'];
const NO_LINK = '__none__';

/**
 * 横向可滚动一行（不是网格换行）：钱包数量因人而异，数量一多网格会挤爆版面，
 * 横向滚动能优雅容纳任意数量（DESIGN-BRIEF.md 第三版「逐区块改动点」第一小节）。
 */
export function WalletGrid({
  tripId,
  wallets,
  paymentMethods,
}: {
  tripId: string;
  wallets: WalletItem[];
  paymentMethods: WalletPaymentMethodOption[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [currency, setCurrency] = useState<string>(COMMON_CURRENCIES[0]);
  const [emoji, setEmoji] = useState(EMOJI_CHOICES[0]);
  const [initialBalanceYuan, setInitialBalanceYuan] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState(NO_LINK);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 只有跟当前选的钱包币种完全一致的支付方式才有意义绑——扣款逻辑要求币种精确匹配，
  // 列出币种不一致的选项只会让人绑了也白绑（app/api/trips/[tripId]/expenses/route.ts）。
  const eligibleMethods = paymentMethods.filter((m) => m.settlementCurrency === currency);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) {
      setError('钱包名不能空着');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/wallets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label: label.trim(),
          currency,
          emoji,
          initialBalance: yuanToCents(Number(initialBalanceYuan) || 0),
          paymentMethodId: paymentMethodId === NO_LINK ? undefined : paymentMethodId,
        }),
      });
      if (!res.ok) {
        setError('新建失败，检查一下表单内容');
        return;
      }
      setLabel('');
      setInitialBalanceYuan('');
      setPaymentMethodId(NO_LINK);
      setCreating(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
        {wallets.map((w) => (
          <div key={w.id} className="w-[120px] shrink-0 rounded-xl border border-sand bg-[#EDE8DA]/35 px-[9px] py-2">
            <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted">
              <span aria-hidden="true">{w.emoji}</span>
              <span className="truncate">{w.label}</span>
            </div>
            <div className="mt-1 font-serif text-sm font-medium tabular-nums">
              {formatMoney(w.currentBalance, w.currency)}
            </div>
            <div className="font-mono text-[10px] text-muted">{w.currency}</div>
            {w.linkedPaymentMethodLabel && (
              <div className="mt-1 truncate text-[10px] text-gold-dk">🔗 {w.linkedPaymentMethodLabel}</div>
            )}
          </div>
        ))}

        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex w-[120px] shrink-0 items-center justify-center rounded-xl border border-dashed border-sand text-xl text-muted"
            aria-label="新建钱包"
          >
            ＋
          </button>
        )}
      </div>

      {creating && (
        <form onSubmit={handleCreate} className="flex flex-col gap-2 rounded-xl border border-sand bg-[#EDE8DA]/35 p-3">
          <div className="grid grid-cols-2 gap-2">
            <input
              className="field-input"
              placeholder="钱包名（比如：泰铢现金）"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <select
              className="field-input"
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value);
                setPaymentMethodId(NO_LINK);
              }}
            >
              {COMMON_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          {eligibleMethods.length > 0 && (
            <select
              className="field-input"
              value={paymentMethodId}
              onChange={(e) => setPaymentMethodId(e.target.value)}
            >
              <option value={NO_LINK}>不绑定支付方式（可以之后再绑）</option>
              {eligibleMethods.map((m) => (
                <option key={m.id} value={m.id}>
                  记账选「{m.label}」时自动扣这个钱包
                </option>
              ))}
            </select>
          )}
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              min="0"
              step="0.01"
              className="field-input"
              placeholder="起始余额（可选）"
              value={initialBalanceYuan}
              onChange={(e) => setInitialBalanceYuan(e.target.value)}
            />
            <div className="flex items-center gap-1">
              {EMOJI_CHOICES.map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => setEmoji(em)}
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-sm ${
                    emoji === em ? 'bg-ink text-paper' : 'bg-white'
                  }`}
                  aria-label={`选 ${em} 图标`}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-coral">{error}</p>}
          <div className="flex items-center gap-2">
            <button type="submit" disabled={submitting} className="btn-primary text-sm">
              {submitting ? '建立中…' : '建立钱包'}
            </button>
            <button type="button" onClick={() => setCreating(false)} className="tap-link text-sm text-muted">
              取消
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
