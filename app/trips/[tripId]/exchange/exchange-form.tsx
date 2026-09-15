'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { COMMON_CURRENCIES } from '@/lib/currencies';
import { yuanToCents, centsToYuan } from '@/lib/money';

export interface WalletOption {
  id: string;
  label: string;
  currency: string;
  emoji: string;
}

const NEW_SOURCE_DEFAULT_EMOJI = '💰';

/**
 * 来源钱包允许不选（表示「纯充值无来源」，比如第一次登记带来的实体现金）。
 *
 * fix(2026-09-15 round10「取款/换汇」结构性缺口补做)：这轮对着 Artifact 逐项核实过，
 * 发现之前几轮只做了「内嵌进钱包卡」这一层（第五轮），字段本身的结构从来没跟上过
 * Artifact 骨架，是典型的「代码看起来动过，但只动了外壳」——这次把底层字段结构
 * 补齐，不是再套一层样式：
 * 1) 「本次汇率」改成可以手动填的字段（之前只有两个金额都填完才倒算隐含汇率展示，
 *    不能反过来先填汇率、自动带出换算金额）；
 * 2) 「＋添加来源钱包」内联快速建钱包（之前完全没有，只能去行程主页另开个钱包）；
 * 3) 「换到 XX·怎么分」支持拆成两个目标钱包（对应 Artifact「现金留 + 存 BKK BANK」
 *    这个真实场景——从换钱店换回来的钱经常要立刻分一部分现金、一部分存进银行户口）；
 * 4) 第二个目标钱包可选填「存款手续费」，从实际入账金额里扣掉。
 * 拆两个目标钱包在 schema 层面没有「一笔换汇两个去向」这种结构（exchange_record
 * 一条记录只有一个 toWalletId），这里改成提交时按目标金额比例拆成 1-2 条
 * exchange_record（共享同一个来源钱包/日期/备注），不是新增表结构——两条记录各自
 * 都是完整独立的换汇记录，跟"一条记录挂两个钱包"的效果一致，日后要查账目一样能
 * 追溯到来源。
 *
 * 没有照抄 Artifact「充值哪个钱包？」那一排「泰铢现金/美金换泰铢/美金现金」按钮——
 * 那三个选项其实是三套「预设情景」的演示切换器（点了整个表单换一套模拟数据），
 * 不是真的钱包选择器，静态稿里也没写清楚这套情景切换该怎么对应到真实的多来源/
 * 多目标数据结构。判断这是演示层面的便利，不是需要照搬的真实交互，这次做的是它
 * 背后真正对应的能力（一笔来源可以拆给两个目标钱包），不是照抄这个情景切换 UI。
 */
export function ExchangeForm({
  tripId,
  wallets,
  onSuccess,
}: {
  tripId: string;
  wallets: WalletOption[];
  // 内嵌进「我的钱包」卡片时传这个：成功后只收起面板+刷新余额，不整页跳转
  // （2026-09-13 第四轮拍板"取款/换汇真正合并进钱包卡内部"）。不传就是原本的
  // 独立页面行为：提交成功跳回行程主页。
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [localWallets, setLocalWallets] = useState<WalletOption[]>(wallets);
  const [fromWalletId, setFromWalletId] = useState<string | null>(null);
  const [toWalletId, setToWalletId] = useState<string | null>(wallets[0]?.id ?? null);
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [toWallet2Id, setToWallet2Id] = useState<string | null>(null);
  const [fromAmountYuan, setFromAmountYuan] = useState('');
  const [rate, setRate] = useState('');
  const [toAmountYuan, setToAmountYuan] = useState('');
  const [toAmount2Yuan, setToAmount2Yuan] = useState('');
  const [depositFeeYuan, setDepositFeeYuan] = useState('');
  const [exchangeDate, setExchangeDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceCurrency, setNewSourceCurrency] = useState<string>(COMMON_CURRENCIES[0]);
  const [addingSource, setAddingSource] = useState(false);
  const [addSourceError, setAddSourceError] = useState<string | null>(null);

  const fromWallet = localWallets.find((w) => w.id === fromWalletId) ?? null;
  const toWallet = localWallets.find((w) => w.id === toWalletId) ?? null;
  const toWallet2 = localWallets.find((w) => w.id === toWallet2Id) ?? null;
  const needsRate = !!fromWallet && !!toWallet && fromWallet.currency !== toWallet.currency;

  async function handleAddSource(e: React.FormEvent) {
    e.preventDefault();
    const name = newSourceName.trim();
    if (!name) {
      setAddSourceError('钱包名不能空着');
      return;
    }
    setAddingSource(true);
    setAddSourceError(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/wallets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: name, currency: newSourceCurrency, emoji: NEW_SOURCE_DEFAULT_EMOJI }),
      });
      if (!res.ok) {
        setAddSourceError('新建失败，检查一下钱包名');
        return;
      }
      const data = (await res.json()) as any;
      const created: WalletOption = {
        id: data.wallet.id,
        label: data.wallet.label,
        currency: data.wallet.currency,
        emoji: data.wallet.emoji,
      };
      setLocalWallets((prev) => [...prev, created]);
      setFromWalletId(created.id);
      setNewSourceName('');
      setAddSourceOpen(false);
      router.refresh();
    } finally {
      setAddingSource(false);
    }
  }

  function applyRateToTotal() {
    const fromAmount = Number(fromAmountYuan);
    const r = Number(rate);
    if (fromAmount > 0 && r > 0) {
      setToAmountYuan((centsToYuan(Math.round(yuanToCents(fromAmount) * r)) || 0).toFixed(2));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!toWalletId) {
      setError('要选一个充值目标钱包');
      return;
    }
    const toAmount = Number(toAmountYuan);
    if (!toAmount || toAmount <= 0) {
      setError('目标金额要大于 0');
      return;
    }
    let fromAmountTotal: number | undefined;
    if (fromWalletId) {
      fromAmountTotal = Number(fromAmountYuan);
      if (!fromAmountTotal || fromAmountTotal <= 0) {
        setError('选了来源钱包就要填拿出的金额');
        return;
      }
    }
    const toAmount2 = splitEnabled ? Number(toAmount2Yuan) || 0 : 0;
    if (splitEnabled && (!toWallet2Id || toAmount2 <= 0)) {
      setError('拆到另一个钱包，要选目标钱包并填大于 0 的金额');
      return;
    }
    const depositFee = splitEnabled ? Number(depositFeeYuan) || 0 : 0;
    const toAmount2Net = Math.max(0, toAmount2 - depositFee);

    const toAmountCents = yuanToCents(toAmount);
    const toAmount2Cents = splitEnabled ? yuanToCents(toAmount2Net) : 0;
    const totalToCents = toAmountCents + toAmount2Cents;
    const fromAmountTotalCents = fromAmountTotal !== undefined ? yuanToCents(fromAmountTotal) : undefined;

    // 按两个目标金额的占比拆来源金额（第一笔用四舍五入，第二笔用总数减第一笔，
    // 避免两次各自四舍五入导致来源总额对不上）。
    const fromAmount1Cents =
      fromAmountTotalCents !== undefined && totalToCents > 0
        ? Math.round((fromAmountTotalCents * toAmountCents) / totalToCents)
        : undefined;
    const fromAmount2Cents =
      fromAmountTotalCents !== undefined && fromAmount1Cents !== undefined
        ? fromAmountTotalCents - fromAmount1Cents
        : undefined;

    setSubmitting(true);
    try {
      const res1 = await fetch(`/api/trips/${tripId}/exchange-records`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fromWalletId: fromWalletId ?? undefined,
          toWalletId,
          fromAmount: fromAmount1Cents,
          toAmount: toAmountCents,
          exchangeDate: new Date(exchangeDate).toISOString(),
          note: note.trim() || undefined,
        }),
      });
      if (!res1.ok) {
        setError('保存失败，检查一下表单内容');
        return;
      }

      if (splitEnabled && toAmount2Cents > 0 && toWallet2Id) {
        const res2 = await fetch(`/api/trips/${tripId}/exchange-records`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            fromWalletId: fromWalletId ?? undefined,
            toWalletId: toWallet2Id,
            fromAmount: fromAmount2Cents,
            toAmount: toAmount2Cents,
            exchangeDate: new Date(exchangeDate).toISOString(),
            note: [note.trim(), depositFee > 0 ? `已扣手续费 ${depositFeeYuan}` : ''].filter(Boolean).join(' · ') || undefined,
          }),
        });
        if (!res2.ok) {
          setError('第一个目标钱包已存，第二个目标钱包保存失败，检查一下再单独补一笔');
          return;
        }
      }

      setFromWalletId(null);
      setFromAmountYuan('');
      setRate('');
      setToAmountYuan('');
      setToAmount2Yuan('');
      setDepositFeeYuan('');
      setSplitEnabled(false);
      setNote('');
      if (onSuccess) {
        onSuccess();
        router.refresh();
      } else {
        router.push(`/trips/${tripId}`);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (localWallets.length === 0) {
    return <p className="text-sm text-muted">先在行程主页新建至少一个钱包，才能记换汇。</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="field-label">来源钱包（不选＝纯充值，没有来源）</span>
          <button
            type="button"
            onClick={() => setAddSourceOpen((v) => !v)}
            className="tap-link shrink-0 whitespace-nowrap text-[9.5px] text-gold-dk underline underline-offset-2"
          >
            ＋ 添加来源钱包
          </button>
        </div>
        {addSourceOpen && (
          <div className="flex flex-col gap-2 rounded-xl border border-sand p-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                value={newSourceName}
                onChange={(e) => setNewSourceName(e.target.value)}
                placeholder="比如：日元现金"
                className="field-input"
              />
              <select
                value={newSourceCurrency}
                onChange={(e) => setNewSourceCurrency(e.target.value)}
                className="field-input"
              >
                {COMMON_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            {addSourceError && <p className="text-[10px] text-coral">{addSourceError}</p>}
            <button type="button" onClick={handleAddSource} disabled={addingSource} className="btn-secondary w-full text-center">
              {addingSource ? '添加中…' : '添加'}
            </button>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setFromWalletId(null)}
            aria-pressed={fromWalletId === null}
            className={
              fromWalletId === null
                ? 'inline-flex min-h-[26px] shrink-0 items-center justify-center rounded-full bg-accent-700 px-[10px] text-[10px] font-medium text-white'
                : 'inline-flex min-h-[26px] shrink-0 items-center justify-center rounded-full border border-sand bg-white px-[10px] text-[10px] font-medium text-muted'
            }
          >
            充值（无来源）
          </button>
          {localWallets.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setFromWalletId(w.id)}
              data-testid={`from-wallet-${w.id}`}
              aria-pressed={fromWalletId === w.id}
              className={
                fromWalletId === w.id
                  ? 'inline-flex min-h-[26px] shrink-0 items-center justify-center rounded-full bg-accent-700 px-[10px] text-[10px] font-medium text-white'
                  : 'inline-flex min-h-[26px] shrink-0 items-center justify-center rounded-full border border-sand bg-white px-[10px] text-[10px] font-medium text-muted'
              }
            >
              {w.emoji} {w.label}
            </button>
          ))}
        </div>
      </div>

      {fromWalletId && (
        <div className="flex flex-col gap-1">
          <label className="field-label" htmlFor="from-amount">
            拿出多少（{fromWallet?.currency}）
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id="from-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={fromAmountYuan}
              onChange={(e) => setFromAmountYuan(e.target.value)}
              className="field-input flex-1 font-serif tabular-nums"
              placeholder="0.00"
            />
            <span className="shrink-0 rounded-lg bg-gold-lt px-[7px] py-[5px] text-[9px] font-semibold text-gold-dk">
              {fromWallet?.currency}
            </span>
          </div>
        </div>
      )}

      {needsRate && (
        <div className="flex flex-col gap-1">
          <label className="field-label" htmlFor="exchange-rate">
            本次汇率 <span className="text-[8.5px] font-normal text-muted">填这一笔实际用到的汇率，不是固定死的</span>
          </label>
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 rounded-lg bg-gold-lt px-[7px] py-[5px] text-[9px] font-semibold text-gold-dk">
              1 {fromWallet?.currency} =
            </span>
            <input
              id="exchange-rate"
              type="number"
              min="0"
              step="0.0001"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              onBlur={applyRateToTotal}
              className="field-input flex-1 font-serif tabular-nums"
              placeholder="0.0000"
            />
            <span className="shrink-0 rounded-lg bg-gold-lt px-[7px] py-[5px] text-[9px] font-semibold text-gold-dk">
              {toWallet?.currency}
            </span>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="field-label">充值到哪个钱包</span>
        <div className="flex flex-wrap gap-1.5">
          {localWallets.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setToWalletId(w.id)}
              data-testid={`to-wallet-${w.id}`}
              aria-pressed={toWalletId === w.id}
              className={
                toWalletId === w.id
                  ? 'inline-flex min-h-[26px] shrink-0 items-center justify-center rounded-full bg-accent-700 px-[10px] text-[10px] font-medium text-white'
                  : 'inline-flex min-h-[26px] shrink-0 items-center justify-center rounded-full border border-sand bg-white px-[10px] text-[10px] font-medium text-muted'
              }
            >
              {w.emoji} {w.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="field-label" htmlFor="to-amount">
          换到{toWallet ? `（${toWallet.currency}）` : ''} · 存多少
        </label>
        <input
          id="to-amount"
          type="number"
          min="0.01"
          step="0.01"
          value={toAmountYuan}
          onChange={(e) => setToAmountYuan(e.target.value)}
          className="field-input font-serif tabular-nums"
          placeholder="0.00"
        />
      </div>

      <label className="flex items-center gap-1.5 text-[10.5px] text-ink">
        <input type="checkbox" checked={splitEnabled} onChange={(e) => setSplitEnabled(e.target.checked)} />
        同时也拆一部分到另一个钱包（比如换回来的钱一部分留现金、一部分存银行）
      </label>

      {splitEnabled && (
        <div className="flex flex-col gap-2 rounded-xl border border-sand bg-[rgba(164,163,160,.14)] p-2">
          <div className="flex flex-col gap-1">
            <span className="field-label">另一个目标钱包</span>
            <div className="flex flex-wrap gap-1.5">
              {localWallets
                .filter((w) => w.id !== toWalletId)
                .map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setToWallet2Id(w.id)}
                    data-testid={`to-wallet-2-${w.id}`}
                    aria-pressed={toWallet2Id === w.id}
                    className={
                      toWallet2Id === w.id
                        ? 'inline-flex min-h-[26px] shrink-0 items-center justify-center rounded-full bg-accent-700 px-[10px] text-[10px] font-medium text-white'
                        : 'inline-flex min-h-[26px] shrink-0 items-center justify-center rounded-full border border-sand bg-white px-[10px] text-[10px] font-medium text-muted'
                    }
                  >
                    {w.emoji} {w.label}
                  </button>
                ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="field-label" htmlFor="to-amount-2">
                存多少{toWallet2 ? `（${toWallet2.currency}）` : ''}
              </label>
              <input
                id="to-amount-2"
                type="number"
                min="0"
                step="0.01"
                value={toAmount2Yuan}
                onChange={(e) => setToAmount2Yuan(e.target.value)}
                className="field-input font-serif tabular-nums"
                placeholder="0.00"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="field-label" htmlFor="deposit-fee">
                存款手续费（可留空）
              </label>
              <input
                id="deposit-fee"
                type="number"
                min="0"
                step="0.01"
                value={depositFeeYuan}
                onChange={(e) => setDepositFeeYuan(e.target.value)}
                className="field-input font-serif tabular-nums"
                placeholder="0.00"
              />
            </div>
          </div>
          <span className="text-[9px] text-muted">从这个钱包实际入账的金额里直接扣，不算进你的消费。</span>
        </div>
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
            地点 / 备注（可选）
          </label>
          <input
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="field-input"
            placeholder="比如：Siam Superrich"
          />
        </div>
      </div>

      {error && <p className="text-[10px] text-coral">{error}</p>}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? '保存中…' : '保存充值记录'}
        </button>
        {onSuccess ? (
          <button type="button" onClick={onSuccess} className="tap-link text-[11px] text-muted">
            取消
          </button>
        ) : (
          <Link href={`/trips/${tripId}`} className="tap-link text-[11px] text-muted">
            取消
          </Link>
        )}
      </div>
    </form>
  );
}
