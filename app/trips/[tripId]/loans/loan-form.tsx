'use client';

import { useRef, useState, useLayoutEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { COMMON_CURRENCIES } from '@/lib/currencies';
import { yuanToCents } from '@/lib/money';
import { SelectDropdown } from '@/components/select-dropdown';
import {
  formatThousands,
  stripThousands,
  countMeaningfulCharsBefore,
  positionForMeaningfulCount,
} from '@/lib/format-thousands';

interface Participant {
  id: string;
  displayName: string;
}

export interface LoanWalletOption {
  id: string;
  label: string;
  currency: string;
  emoji: string;
}

/** "不指定钱包"这个选项的 value——跟 SelectDropdown 的 value/onChange 单值模型兼容，
 * 提交时转换成 undefined（不传 fromWalletId），不是字面意义上的钱包 id。 */
const NO_WALLET_VALUE = '__none__';

const API_ERROR_LABEL: Record<string, string> = {
  lender_borrower_same: '出借人跟借入人不能是同一个人',
  invalid_lender: '出借人不在这个行程里',
  invalid_borrower: '借入人不在这个行程里',
  invalid_from_wallet: '这个钱包不是你自己名下的',
};

/**
 * 借钱给同行人——新表 loan，跟记消费完全独立的一张表（见 lib/db/schema.ts loan
 * 顶部大段注释）。「从哪个钱包出」只列**我自己**名下的钱包（跟 exchange-form.tsx
 * 的钱包私有规矩一致），另加一个「不指定钱包」选项（开放问题①：不经过任何钱包
 * 的现金往来，比如借出去的是同行人手上的现金，或者就是不想追踪具体从哪笔出）。
 */
export function LoanForm({
  tripId,
  myParticipantId,
  baseCurrency,
  participants,
  wallets,
}: {
  tripId: string;
  myParticipantId: string;
  baseCurrency: string;
  participants: Participant[];
  wallets: LoanWalletOption[];
}) {
  const router = useRouter();
  const otherParticipants = participants.filter((p) => p.id !== myParticipantId);

  const [lenderParticipantId, setLenderParticipantId] = useState(myParticipantId);
  const [borrowerParticipantId, setBorrowerParticipantId] = useState(otherParticipants[0]?.id ?? myParticipantId);
  const [amountYuan, setAmountYuan] = useState('');
  const amountInputRef = useRef<HTMLInputElement>(null);
  const pendingCursorRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const pendingCount = pendingCursorRef.current;
    if (pendingCount === null) return;
    pendingCursorRef.current = null;
    const input = amountInputRef.current;
    if (!input) return;
    const displayValue = formatThousands(amountYuan);
    const pos = positionForMeaningfulCount(displayValue, pendingCount);
    input.setSelectionRange(pos, pos);
  }, [amountYuan]);
  const [currency, setCurrency] = useState(baseCurrency);
  const [fromWalletId, setFromWalletId] = useState(wallets[0]?.id ?? NO_WALLET_VALUE);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currencyOptions = Array.from(new Set([baseCurrency, ...COMMON_CURRENCIES]));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (lenderParticipantId === borrowerParticipantId) {
      setError('出借人跟借入人不能是同一个人');
      return;
    }
    const amount = Number(amountYuan);
    if (!amount || amount <= 0) {
      setError('金额要大于 0');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/loans`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lenderParticipantId,
          borrowerParticipantId,
          amount: yuanToCents(amount),
          currency,
          fromWalletId: fromWalletId === NO_WALLET_VALUE ? undefined : fromWalletId,
          date: new Date(date).toISOString(),
          note: note.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const body = await (res.json() as Promise<any>).catch(() => null);
        setError((body?.error && API_ERROR_LABEL[body.error]) ?? '保存失败，检查一下表单内容');
        return;
      }

      router.push(`/trips/${tripId}`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <span className="field-label">出借人</span>
          <SelectDropdown
            ariaLabel="出借人"
            value={lenderParticipantId}
            onChange={setLenderParticipantId}
            triggerClassName="field-input w-full"
            options={participants.map((p) => ({ value: p.id, label: p.displayName }))}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="field-label">借入人</span>
          <SelectDropdown
            ariaLabel="借入人"
            value={borrowerParticipantId}
            onChange={setBorrowerParticipantId}
            triggerClassName="field-input w-full"
            options={participants.map((p) => ({ value: p.id, label: p.displayName }))}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="field-label" htmlFor="loan-amount">
          金额
        </label>
        <div className="flex items-center gap-1.5">
          <input
            id="loan-amount"
            ref={amountInputRef}
            type="text"
            inputMode="decimal"
            value={formatThousands(amountYuan)}
            onChange={(e) => {
              const rawInput = e.target.value;
              const selectionStart = e.target.selectionStart ?? rawInput.length;
              const meaningfulBefore = countMeaningfulCharsBefore(rawInput, selectionStart);
              const candidate = stripThousands(rawInput);
              if (!/^\d*\.?\d*$/.test(candidate)) return;
              pendingCursorRef.current = meaningfulBefore;
              setAmountYuan(candidate);
            }}
            placeholder="0.00"
            aria-label="金额"
            className="field-input flex-1 font-serif tabular-nums"
          />
          <SelectDropdown
            ariaLabel="币种"
            value={currency}
            onChange={setCurrency}
            triggerClassName="field-input shrink-0"
            options={currencyOptions.map((c) => ({ value: c, label: c }))}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="field-label">从哪个钱包出</span>
        {wallets.length > 0 ? (
          <SelectDropdown
            ariaLabel="从哪个钱包出"
            value={fromWalletId}
            onChange={setFromWalletId}
            triggerClassName="field-input w-full"
            options={[
              ...wallets.map((w) => ({ value: w.id, label: `${w.emoji} ${w.label}（${w.currency}）` })),
              { value: NO_WALLET_VALUE, label: '不指定钱包（不经过任何钱包的现金往来）' },
            ]}
          />
        ) : (
          <SelectDropdown
            ariaLabel="从哪个钱包出"
            value={NO_WALLET_VALUE}
            onChange={() => {}}
            triggerClassName="field-input w-full"
            options={[{ value: NO_WALLET_VALUE, label: '不指定钱包（还没建过钱包）' }]}
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="field-label" htmlFor="loan-date">
            日期
          </label>
          <input
            id="loan-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="field-input"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="field-label" htmlFor="loan-note">
            备注（可选）
          </label>
          <input
            id="loan-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="field-input"
            placeholder="比如：垫机票钱"
          />
        </div>
      </div>

      {error && <p className="text-[10px] text-coral">{error}</p>}

      <div className="flex flex-col items-center gap-2">
        <button type="submit" disabled={submitting} className="big-cta">
          {submitting ? '保存中…' : '保存借出记录'}
        </button>
        <Link href={`/trips/${tripId}`} className="tap-link text-[11px] text-muted">
          取消
        </Link>
      </div>
    </form>
  );
}
