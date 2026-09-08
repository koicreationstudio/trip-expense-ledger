'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function MarkSettledButton({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!confirm('确定要标记这个行程为已结算吗？之后这份净额清单会被冻结，明细改动也不会再影响它。')) {
      return;
    }
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
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={submitting}
        className="btn-primary"
      >
        {submitting ? '处理中…' : '标记已结算'}
      </button>
      {error && <p className="text-sm text-coral">{error}</p>}
    </div>
  );
}
