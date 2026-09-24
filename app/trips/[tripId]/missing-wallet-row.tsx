'use client';

import { useState } from 'react';

export interface MissingWalletMethod {
  id: string;
  label: string;
  kind: 'card' | 'cash';
  settlementCurrency: string;
}

/** 建钱包成功后服务器返回的钱包（`toWalletDto` 的字段子集，两处调用方各自只用到自己需要的那几个）。 */
export interface CreatedWalletDto {
  id: string;
  label: string;
  currency: string;
  emoji: string;
  currentBalance: number;
  paymentMethodId: string | null;
  balanceUpdatedAt: string | null;
}

/**
 * 「本行程已开启但还没建对应钱包」的占位行/占位卡——2026-09-24 第五十八轮从
 * `payment-methods-manager.tsx` 抽出来的共享组件（Remy 明确要求："钱包"这套判断
 * 逻辑/建钱包交互，行程主页「我的钱包」区块也要出现同一套，不要另起一份）。
 *
 * 建钱包的请求逻辑（`POST /api/trips/[tripId]/wallets`，绑 `paymentMethodId` 这条
 * 创建路径自带历史消费一次性回溯补算，见该路由文件注释）+ loading/error 状态全部
 * 收在这一个组件里；两处调用方（支付方式设置页的清单行 / 行程主页钱包卡的横向
 * 卡片）只需要传 `variant` 决定外壳视觉，判断"哪些支付方式缺钱包"+ 建钱包这件事
 * 的行为完全共用一份实现，不会两边各自维护一份、以后改一处漏改另一处。
 *
 * `variant`：
 * - 'list-row'：`payment-methods-manager.tsx` 的 `.list` 容器里一行（跟真实钱包行
 *   同一个 `<li>` 视觉规格，opacity-70 弱化 + 虚线边「建钱包」按钮）。
 * - 'chip-dark'：`wallet-grid.tsx` embedded-dark 变体（行程主页「我的钱包」深色卡），
 *   跟真实钱包卡片同一档 64px 起步窄卡片语言。
 * - 'chip-light'：`wallet-grid.tsx` default 变体，120px 浅色卡片。
 */
export function MissingWalletRow({
  tripId,
  method,
  variant,
  onCreated,
}: {
  tripId: string;
  method: MissingWalletMethod;
  variant: 'list-row' | 'chip-dark' | 'chip-light';
  onCreated: (wallet: CreatedWalletDto) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    setCreating(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/wallets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label: method.label,
          currency: method.settlementCurrency,
          emoji: method.kind === 'card' ? '💳' : '💵',
          paymentMethodId: method.id,
        }),
      });
      if (!res.ok) {
        setError(`「${method.label}」建钱包失败，稍后再试。`);
        return;
      }
      const data = (await res.json()) as { wallet: CreatedWalletDto };
      onCreated(data.wallet);
    } finally {
      setCreating(false);
    }
  }

  const emoji = method.kind === 'card' ? '💳' : '💵';
  const title = '这趟行程已开启这个支付方式，但还没建对应的钱包，没法追踪余额。';
  const ariaLabel = `「${method.label}」这趟行程已开启，但还没建对应的钱包，点击建钱包`;

  if (variant === 'list-row') {
    return (
      <li
        className="flex items-center gap-[5px] border-b border-sand py-[4px] opacity-70 last:border-b-0"
        title={title}
      >
        <span aria-hidden="true" className="shrink-0">
          {emoji}
        </span>
        <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-muted">
          {method.label} <span className="font-mono text-[8.5px] text-muted">{method.settlementCurrency}</span>
        </span>
        <button
          type="button"
          disabled={creating}
          onClick={handleCreate}
          aria-label={ariaLabel}
          className="shrink-0 rounded-full border border-dashed border-sand bg-white px-[8px] py-[3px] text-[9px] font-medium text-ink transition-colors hover:bg-slate-50 disabled:opacity-50"
        >
          {creating ? '建立中…' : '建钱包'}
        </button>
        {error && <p className="w-full text-[9px] text-coral">{error}</p>}
      </li>
    );
  }

  const isDark = variant === 'chip-dark';
  return (
    <div
      className={
        isDark
          ? 'flex min-w-[64px] shrink-0 flex-col items-center justify-center gap-[3px] rounded-[9px] border border-dashed border-white/30 bg-white/[.04] px-2 py-[5px]'
          : 'flex w-[120px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-sand bg-[rgba(164,163,160,.08)] px-[9px] py-2'
      }
      title={title}
    >
      {/* fix(2026-09-24 第五十八轮，真机走查实测发现的第三处歧义 bug，A 范围外顺手修)：
          chip 变体只显示 emoji+label，名下两个都叫"现金"(HKD 结算/USD 结算)的支付方式
          在这里完全分不清是哪一个——list-row 变体本来就在 label 后面带一个 settlementCurrency
          小字（"现金 HKD"/"现金 USD"），chip 这两个变体当时漏了同一处信息，补上跟 list-row
          一致的币种小字，不用额外接消歧义 helper（这里币种本来就摆在旁边，天然消歧义）。 */}
      <div
        className={`flex flex-col items-center gap-0 text-center ${isDark ? 'text-[8.5px] text-hero-label' : 'text-[10px] text-muted'}`}
      >
        <span className="flex items-center gap-[3px]">
          <span aria-hidden="true">{emoji}</span>
          <span className="truncate">{method.label}</span>
        </span>
        <span className={`font-mono ${isDark ? 'text-[7.5px]' : 'text-[8.5px]'}`}>{method.settlementCurrency}</span>
      </div>
      <button
        type="button"
        disabled={creating}
        onClick={handleCreate}
        aria-label={ariaLabel}
        className={
          isDark
            ? 'whitespace-nowrap rounded-full border border-dashed border-white/50 px-[7px] py-[2px] text-[8.5px] font-medium text-white disabled:opacity-50'
            : 'whitespace-nowrap rounded-full border border-dashed border-sand bg-white px-[8px] py-[3px] text-[9px] font-medium text-ink disabled:opacity-50'
        }
      >
        {creating ? '建立中…' : '建钱包'}
      </button>
      {error && (
        <p className={`text-center text-[8px] leading-tight ${isDark ? 'text-negative-dk' : 'text-coral'}`}>
          {error}
        </p>
      )}
    </div>
  );
}
