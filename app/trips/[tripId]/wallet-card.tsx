'use client';

import { useState } from 'react';
import { WalletGrid, type WalletItem, type WalletPaymentMethodOption } from './wallet-grid';
import { ExchangeForm, type WalletOption } from './exchange/exchange-form';
import { QuickAddExpense } from './quick-add-expense';

interface Participant {
  id: string;
  displayName: string;
}

/**
 * 「我的钱包」独立卡片——2026-09-13 落地 Artifact Version 10（第四轮拍板）：
 * 这轮把原本跟净额 Hero 合并成一张深色卡的钱包区块拆回两张独立卡片
 * （Artifact 自己就是 `.hero` + `.wallet-block` 两个分开的卡，不是拍脑袋决定），
 * 理由是钱包卡这次要自己的三档色阶切换器，合并卡片没法自然装下这个交互。
 *
 * 背景默认 #2E2E2C（浅档，Artifact 定案默认值），点右上角三个小圆点可以实时切
 * 深 #1A1A19 / 中 #242422 / 浅 #2E2E2C，纯前端 state，不存后端（Artifact 没有
 * 这个持久化要求）。
 *
 * 「取款/换汇」这次真正内嵌进卡片（第四轮拍板明确要求"真正实现"，不是文字描述）：
 * 点了不再跳转到 /exchange/new 独立页面，原地在卡片内部展开一个白色小面板，
 * ExchangeForm 复用同一个组件，通过 onSuccess 回调区分"页面模式"（push 走人）
 * 和"内嵌模式"（收起面板 + refresh 就地刷新余额），不用另起一份表单逻辑。
 */
export function WalletCard({
  tripId,
  baseCurrency,
  myParticipantId,
  participants,
  wallets,
  paymentMethods,
}: {
  tripId: string;
  baseCurrency: string;
  myParticipantId: string;
  participants: Participant[];
  wallets: WalletItem[];
  paymentMethods: WalletPaymentMethodOption[];
}) {
  const SHADE_OPTIONS = ['#1A1A19', '#242422', '#2E2E2C'] as const; // 深 / 中 / 浅(默认)
  const [shade, setShade] = useState<string>(SHADE_OPTIONS[2]);
  const [exchangeOpen, setExchangeOpen] = useState(false);

  const exchangeWallets: WalletOption[] = wallets.map((w) => ({
    id: w.id,
    label: w.label,
    currency: w.currency,
    emoji: w.emoji,
  }));

  return (
    <section
      className="relative flex flex-col gap-[8px] overflow-hidden rounded-[14px] p-[9px] text-white shadow-hero transition-colors"
      style={{ backgroundColor: shade }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] uppercase tracking-wide text-hero-label">我的钱包</span>
        <div className="flex shrink-0 items-center gap-[7px]">
          <span className="text-[9px] text-hero-label">仅自己可见</span>
          <div className="flex items-center gap-[5px]" role="group" aria-label="钱包卡背景色阶">
            {SHADE_OPTIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setShade(c)}
                aria-label={`换成背景色 ${c}`}
                aria-pressed={shade === c}
                className="h-[13px] w-[13px] shrink-0 rounded-full"
                style={{ backgroundColor: c, border: `1.5px solid ${shade === c ? '#fff' : 'rgba(255,255,255,.35)'}` }}
              />
            ))}
          </div>
        </div>
      </div>

      <WalletGrid variant="embedded-dark" tripId={tripId} wallets={wallets} paymentMethods={paymentMethods} />

      <button
        type="button"
        onClick={() => setExchangeOpen((v) => !v)}
        className="tap-link self-start text-[11px] text-hero-label"
      >
        💱 取款 / 换汇 {exchangeOpen ? '▲' : ''}
      </button>

      {exchangeOpen && (
        <div className="rounded-[12px] bg-white p-[8px] text-ink">
          {exchangeWallets.length === 0 ? (
            <p className="text-[10px] text-muted">先在上面新建至少一个钱包，才能记换汇。</p>
          ) : (
            <ExchangeForm tripId={tripId} wallets={exchangeWallets} onSuccess={() => setExchangeOpen(false)} />
          )}
        </div>
      )}

      <QuickAddExpense
        tripId={tripId}
        baseCurrency={baseCurrency}
        myParticipantId={myParticipantId}
        participants={participants}
      />
    </section>
  );
}
