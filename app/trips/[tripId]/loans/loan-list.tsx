'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatMoney } from '@/lib/money';
import { yuanToCents } from '@/lib/money';
import { SelectDropdown } from '@/components/select-dropdown';
import type { LoanStatus } from '@/lib/domain/loan';
import {
  formatThousands,
  stripThousands,
} from '@/lib/format-thousands';

export interface LoanWalletOption {
  id: string;
  label: string;
  currency: string;
  emoji: string;
}

export interface LoanListItem {
  id: string;
  lenderName: string;
  borrowerName: string;
  amount: number;
  currency: string;
  date: string; // ISO
  note: string | null;
  progress: {
    repaidAmount: number;
    outstandingAmount: number;
    percentRepaid: number;
    status: LoanStatus;
  };
}

const STATUS_LABEL: Record<LoanStatus, string> = {
  unpaid: '未还',
  partial: '部分还',
  paid: '已还清',
};

const NO_WALLET_VALUE = '__none__';

/**
 * 「借款清单」——round72b 新增，跟 exchange-record-list.tsx 是同一类"整块独立
 * 展示 + 各行自己带一份小交互"结构。这轮只做"汇总展示"（开放问题②），每行只有
 * 一个聚合后的进度条 + 一句"已还 X / 共 Y"，没有展开逐笔还款历史这个入口。
 *
 * 还款按钮点开是行内小表单（不整页跳转），提交完 `router.refresh()`——跟
 * exchange-form.tsx 内嵌进钱包卡那种"就地展开"是同一套模式，不是另起一套。
 */
export function LoanList({
  tripId,
  loans,
  wallets,
}: {
  tripId: string;
  loans: LoanListItem[];
  wallets: LoanWalletOption[];
}) {
  const router = useRouter();
  const [repayingLoanId, setRepayingLoanId] = useState<string | null>(null);

  if (loans.length === 0) {
    return <p className="text-[11.5px] text-muted">还没有借出记录，点下面「＋」→「借钱给同行人」开始记。</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {loans.map((loan) => (
        <li key={loan.id} className="flex flex-col gap-1.5 rounded-xl border border-sand bg-white p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-medium text-ink">
              {loan.lenderName} → {loan.borrowerName}
            </span>
            <span className="shrink-0 font-serif text-[12.5px] font-medium tabular-nums text-ink">
              {formatMoney(loan.amount, loan.currency)}
            </span>
          </div>
          <span className="truncate text-[10px] text-muted">
            {loan.date.slice(5, 10)}
            {loan.note && ` · ${loan.note}`}
          </span>

          <div className="flex flex-col gap-1">
            <div className="h-[6px] w-full overflow-hidden rounded-full bg-neutral-lt" role="presentation">
              <div
                className={`h-full rounded-full ${loan.progress.status === 'paid' ? 'bg-positive' : 'bg-ink'}`}
                style={{ width: `${loan.progress.percentRepaid}%` }}
              />
            </div>
            <div className="flex items-center justify-between gap-2 text-[10px]">
              <span className={loan.progress.status === 'paid' ? 'text-positive' : 'text-muted'}>
                {STATUS_LABEL[loan.progress.status]} · 已还 {formatMoney(loan.progress.repaidAmount, loan.currency)}
                {loan.progress.status !== 'paid' && ` / 共 ${formatMoney(loan.amount, loan.currency)}`}
              </span>
              {loan.progress.status !== 'paid' && (
                <button
                  type="button"
                  onClick={() => setRepayingLoanId((cur) => (cur === loan.id ? null : loan.id))}
                  className="tap-link shrink-0 whitespace-nowrap text-[10px] text-neutral-dk underline underline-offset-2"
                >
                  {repayingLoanId === loan.id ? '收起' : '记还款'}
                </button>
              )}
            </div>
          </div>

          {repayingLoanId === loan.id && (
            <RepayInlineForm
              tripId={tripId}
              loanId={loan.id}
              currency={loan.currency}
              wallets={wallets}
              onDone={() => {
                setRepayingLoanId(null);
                router.refresh();
              }}
              onCancel={() => setRepayingLoanId(null)}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

function RepayInlineForm({
  tripId,
  loanId,
  currency,
  wallets,
  onDone,
  onCancel,
}: {
  tripId: string;
  loanId: string;
  currency: string;
  wallets: LoanWalletOption[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [amountYuan, setAmountYuan] = useState('');
  const [toWalletId, setToWalletId] = useState(wallets[0]?.id ?? NO_WALLET_VALUE);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amount = Number(amountYuan);
    if (!amount || amount <= 0) {
      setError('金额要大于 0');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/loans/${loanId}/repayments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          amount: yuanToCents(amount),
          toWalletId: toWalletId === NO_WALLET_VALUE ? undefined : toWalletId,
          date: new Date(date).toISOString(),
          note: note.trim() || undefined,
        }),
      });
      if (!res.ok) {
        setError('保存失败，检查一下表单内容');
        return;
      }
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-1.5 rounded-lg bg-[rgba(164,163,160,.14)] p-1.5"
    >
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          inputMode="decimal"
          value={formatThousands(amountYuan)}
          onChange={(e) => {
            const candidate = stripThousands(e.target.value);
            if (!/^\d*\.?\d*$/.test(candidate)) return;
            setAmountYuan(candidate);
          }}
          placeholder={`还多少（${currency}）`}
          aria-label="还款金额"
          className="field-input flex-1 font-serif tabular-nums"
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="还款日期"
          className="field-input shrink-0"
        />
      </div>
      {wallets.length > 0 && (
        <SelectDropdown
          ariaLabel="还款进哪个钱包"
          value={toWalletId}
          onChange={setToWalletId}
          triggerClassName="field-input w-full"
          options={[
            ...wallets.map((w) => ({ value: w.id, label: `${w.emoji} ${w.label}（${w.currency}）` })),
            { value: NO_WALLET_VALUE, label: '不指定钱包（不经过任何钱包的现金往来）' },
          ]}
        />
      )}
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="备注（可选）"
        aria-label="还款备注"
        className="field-input"
      />
      {error && <p className="text-[10px] text-coral">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="tap-link text-[10.5px] text-muted">
          取消
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex min-h-[26px] shrink-0 items-center justify-center rounded-full bg-ink px-3 text-[10.5px] font-medium text-white disabled:opacity-50"
        >
          {submitting ? '保存中…' : '确认还款'}
        </button>
      </div>
    </form>
  );
}
