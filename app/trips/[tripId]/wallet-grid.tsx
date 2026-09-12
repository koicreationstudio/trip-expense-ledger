'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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

// fix(2026-09-12 走查)：原本是纯 emoji 按钮，选了哪个类型全靠猜。改成 {emoji, label}
// 数组，配合下面「已选：xx」常显小字 + 每颗按钮的 title 悬浮提示，两条腿一起解决
// 「看不懂选的是什么」——常显文字满足手机触屏（没有 hover），title 顺手满足桌面。
// 没在按钮旁边逐个摆文字标签：7 个类型都要摆的话（"银行卡"/"网络钱包"这种 2-4 字）
// 横向空间不够摆一整排还不换行，压缩比 compact 目标更糟。
const ICON_CHOICES = [
  { emoji: '🏦', label: '银行' },
  { emoji: '💵', label: '现金' },
  { emoji: '🌐', label: '网络钱包' },
  { emoji: '📱', label: '手机支付' },
  { emoji: '🟠', label: '电子钱包' },
  { emoji: '💳', label: '信用卡' },
  { emoji: '💰', label: '零钱' },
] as const;
const NO_LINK = '__none__';

/**
 * 横向可滚动一行（不是网格换行）：钱包数量因人而异，数量一多网格会挤爆版面，
 * 横向滚动能优雅容纳任意数量（DESIGN-BRIEF.md 第三版「逐区块改动点」第一小节）。
 */
export function WalletGrid({
  tripId,
  wallets,
  paymentMethods,
  variant = 'default',
}: {
  tripId: string;
  wallets: WalletItem[];
  paymentMethods: WalletPaymentMethodOption[];
  // 'embedded-dark'：塞进方案C 合并卡（深色渐变底）时用，只换钱包胶囊本身的配色
  // （套 DESIGN-BRIEF-hero-wallet-variants.html .wallet-c-chip 规格），不影响「新建钱包」
  // 表单——那段设计稿完全没提规格，继续用现有浅色表单样式渲染在深色卡外面。
  variant?: 'default' | 'embedded-dark';
}) {
  const isDark = variant === 'embedded-dark';
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [currency, setCurrency] = useState<string>(COMMON_CURRENCIES[0]);
  const [emoji, setEmoji] = useState<string>(ICON_CHOICES[0].emoji);
  const [initialBalanceYuan, setInitialBalanceYuan] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState(NO_LINK);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedIconLabel = ICON_CHOICES.find((c) => c.emoji === emoji)?.label ?? '';

  // 只有跟当前选的钱包币种完全一致的支付方式才有意义绑——扣款逻辑要求币种精确匹配，
  // 列出币种不一致的选项只会让人绑了也白绑（app/api/trips/[tripId]/expenses/route.ts）。
  const eligibleMethods = paymentMethods.filter((m) => m.settlementCurrency === currency);

  // embedded-dark 时「新建钱包」表单不跟着做深色版本（设计稿没规格），而是原样保留浅色
  // 表单外观，用 portal 挂到 page.tsx 在合并卡下方留的 #wallet-form-slot 插槽，让它渲染在
  // 深色卡外面（而不是塞进卡内部看不清）。default 模式没有这个插槽，表单照旧就地渲染。
  const [formSlot, setFormSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (isDark) {
      setFormSlot(document.getElementById('wallet-form-slot'));
    }
  }, [isDark]);

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

  // fix(2026-09-12 走查)：compact 化对齐 expense-form.tsx 的记账表单——字段一律
  // field-label(10px)+field-input(12.5px/px-[9px] py-2/rounded-xl) 这套已定案的
  // token，不新造尺寸；每个字段都带常显标签（原本纯靠 placeholder，输入后标签就
  // 消失，看不出这格是什么）。账户类型图标原本跟起始余额挤同一个 grid-cols-2 半栏
  // （只有约 155px 宽却要塞 7 颗 28px 圆钮），flex 没设 shrink-0 导致被压扁成
  // 20×28 的椭圆；这次让图标行独占一整行宽度，够摆下 7 颗不用挤。
  const formNode = creating && (
    <form onSubmit={handleCreate} className="flex flex-col gap-2 rounded-xl border border-sand bg-[rgba(164,163,160,.14)] p-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="field-label" htmlFor="wallet-label">
            钱包名
          </label>
          <input
            id="wallet-label"
            className="field-input"
            placeholder="比如：泰铢现金"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="field-label" htmlFor="wallet-currency">
            币种
          </label>
          <select
            id="wallet-currency"
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
      </div>
      {eligibleMethods.length > 0 && (
        <div className="flex flex-col gap-1">
          <label className="field-label" htmlFor="wallet-payment-method">
            绑定支付方式
          </label>
          <select
            id="wallet-payment-method"
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
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label className="field-label" htmlFor="wallet-balance">
          起始余额（可选）
        </label>
        <input
          id="wallet-balance"
          type="number"
          min="0"
          step="0.01"
          className="field-input"
          placeholder="0.00"
          value={initialBalanceYuan}
          onChange={(e) => setInitialBalanceYuan(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="field-label">账户类型</span>
        <div className="flex flex-wrap items-center gap-1">
          {ICON_CHOICES.map(({ emoji: em, label: emLabel }) => (
            <button
              key={em}
              type="button"
              title={emLabel}
              onClick={() => setEmoji(em)}
              aria-pressed={emoji === em}
              aria-label={`账户类型：${emLabel}`}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm ${
                emoji === em ? 'bg-ink text-paper' : 'bg-white'
              }`}
            >
              {em}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-muted">已选：{selectedIconLabel}</span>
      </div>
      {/* 没套 expense-form.tsx 那个 rounded-xl+bg 提示盒——那个盒子的浅灰底色是靠反衬
          page.tsx 的纯 bg-paper 页面底色出效果的；这个表单本身就是 bg-[rgba(164,163,160,.14)]
          底，同色盒子叠同色底会看不出盒子只剩边框，索性跟 quick-add-expense.tsx 的错误提示
          一样只用纯文字，字号仍收到跟其它说明性小字同一档 10px。 */}
      {error && <p className="text-[10px] text-coral">{error}</p>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? '建立中…' : '建立钱包'}
        </button>
        <button type="button" onClick={() => setCreating(false)} className="tap-link text-[12.5px] text-muted">
          取消
        </button>
      </div>
    </form>
  );

  return (
    <>
    <div className="flex flex-col gap-2">
      <div className={isDark ? 'flex gap-[7px] overflow-x-auto' : '-mx-4 flex gap-3 overflow-x-auto px-4 pb-1'}>
        {wallets.map((w) =>
          isDark ? (
            <div
              key={w.id}
              className="flex min-w-[64px] shrink-0 flex-col gap-[1px] rounded-[9px] bg-white/[.08] px-2 py-[5px]"
            >
              <div className="flex items-center gap-[3px] text-[8.5px] text-hero-label">
                <span aria-hidden="true">{w.emoji}</span>
                <span className="truncate">{w.label}</span>
              </div>
              <div className="font-serif text-[11.5px] tabular-nums text-white">
                {formatMoney(w.currentBalance, w.currency)}
              </div>
            </div>
          ) : (
            <div key={w.id} className="w-[120px] shrink-0 rounded-xl border border-sand bg-[rgba(164,163,160,.14)] px-[9px] py-2">
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
          ),
        )}

        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className={
              isDark
                ? 'flex w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-white/[.06] text-sm text-hero-label'
                : 'flex w-[120px] shrink-0 items-center justify-center rounded-xl border border-dashed border-sand text-xl text-muted'
            }
            aria-label="新建钱包"
          >
            ＋
          </button>
        )}
      </div>

      {/* default 模式表单原地渲染；embedded-dark 模式表单改走下面的 portal，挂到深色卡外面的插槽 */}
      {!isDark && formNode}
    </div>
    {isDark && formNode && formSlot ? createPortal(formNode, formSlot) : null}
    </>
  );
}
