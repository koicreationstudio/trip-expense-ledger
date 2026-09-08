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
}

const EMOJI_CHOICES = ['🏦', '💵', '🌐', '📱', '🟠', '💳', '💰'];

/**
 * 横向可滚动一行（不是网格换行）：钱包数量因人而异，数量一多网格会挤爆版面，
 * 横向滚动能优雅容纳任意数量（DESIGN-BRIEF.md 第三版「逐区块改动点」第一小节）。
 */
export function WalletGrid({ tripId, wallets }: { tripId: string; wallets: WalletItem[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [currency, setCurrency] = useState<string>(COMMON_CURRENCIES[0]);
  const [emoji, setEmoji] = useState(EMOJI_CHOICES[0]);
  const [initialBalanceYuan, setInitialBalanceYuan] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        }),
      });
      if (!res.ok) {
        setError('新建失败，检查一下表单内容');
        return;
      }
      setLabel('');
      setInitialBalanceYuan('');
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
          <div key={w.id} className="w-[136px] shrink-0 rounded-xl border border-sand bg-paper p-3">
            <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted">
              <span aria-hidden="true">{w.emoji}</span>
              <span className="truncate">{w.label}</span>
            </div>
            <div className="mt-1 font-serif text-lg font-medium tabular-nums">
              {formatMoney(w.currentBalance, w.currency)}
            </div>
            <div className="text-[10px] text-muted">{w.currency}</div>
          </div>
        ))}

        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex w-[136px] shrink-0 items-center justify-center rounded-xl border border-dashed border-sand text-2xl text-muted"
            aria-label="新建钱包"
          >
            ＋
          </button>
        )}
      </div>

      {creating && (
        <form onSubmit={handleCreate} className="flex flex-col gap-2 rounded-xl border border-sand bg-paper p-3">
          <div className="grid grid-cols-2 gap-2">
            <input
              className="field-input"
              placeholder="钱包名（比如：泰铢现金）"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <select className="field-input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {COMMON_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
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
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-base ${
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
