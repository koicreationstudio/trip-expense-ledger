'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/confirm-dialog';

export function MarkSettledButton({
  tripId,
  disabled = false,
}: {
  tripId: string;
  // 2026-09-13 落地第四轮拍板：转账清单按笔勾选"已收款"没勾完之前，这颗按钮禁用变灰，
  // 全部勾完才解锁——由父组件（settlement-body.tsx 算好 disabled 状态传下来，这个
  // 组件自己不查确认状态。
  disabled?: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function handleConfirm() {
    setConfirming(false);
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/settlement`, { method: 'POST' });
      if (!res.ok) {
        setError('标记失败，刷新页面再试一次');
        return;
      }
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // fix(2026-09-17 第十九轮，独立 ui-auditor 盲测坐实)：Artifact 这颗按钮是
    // `<button class="big-cta" style="background:var(--gold-dk)" disabled>等所有转账
    // 确认收款后 · 整个行程才会标记已结算</button>`——跟表单/清单同宽的整行按钮，
    // 没收齐时按钮本身的文字就是这句提示，不是"紧凑按钮 + 下面单独一行小字"。
    // 2026-09-12 那次"修复"把 .btn-primary 从意外撑满全宽改回了紧凑胶囊，
    // 这次连同 .btn-primary→.big-cta 一起改，是真的要撑满，不是要避免撑满，
    // 那次的 items-start 手法（防止 flex-col 意外拉宽）已经不需要了，删掉。
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={submitting || disabled}
        className="big-cta"
        style={disabled ? { backgroundColor: '#6E6E6C' } : undefined}
      >
        {submitting
          ? '处理中…'
          : disabled
            ? '等所有转账确认收款后 · 整个行程才会标记已结算'
            : '标记已结算'}
      </button>
      {error && (
        <p className="rounded-xl border border-sand bg-[rgba(164,163,160,.14)] px-[9px] py-[5px] text-[10px] text-coral">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={confirming}
        message="确定要标记这个行程为已结算吗？之后这份净额清单会被冻结，明细改动也不会再影响它。"
        confirmLabel="标记已结算"
        variant="default"
        onConfirm={handleConfirm}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
