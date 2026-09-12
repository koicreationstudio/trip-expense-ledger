'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/confirm-dialog';

export function MarkSettledButton({ tripId }: { tripId: string }) {
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
    // fix(2026-09-12 走查)：外层用 flex flex-col 只是想让按钮和下面的错误提示上下堆叠，
    // 没料到 flex-col 容器默认 align-items:stretch 会把里面这个 inline-flex 的
    // .btn-primary 撑满整行宽度，变成贯穿全宽的深色胶囊——这不是 .btn-primary 本身的
    // 问题（同一个 class 用在 expense-form.tsx"记这笔账"/FAB"记一笔消费"上都是紧凑尺寸，
    // 因为那两处外层用的是 flex items-center 这种"行"容器，交叉轴是高度不是宽度，不会被
    // 撑宽）。加 items-start 让这个 flex-col 容器的交叉轴（水平方向）改成"按内容宽度对齐
    // 到起点"，按钮就恢复跟其它 .btn-primary 一样的胶囊比例，不用改 class 本身。
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={submitting}
        className="btn-primary"
      >
        {submitting ? '处理中…' : '标记已结算'}
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
