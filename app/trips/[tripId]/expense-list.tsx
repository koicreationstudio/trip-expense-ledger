'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatMoney } from '@/lib/money';
import { Avatar } from '@/components/avatar';

export interface ExpenseListItem {
  id: string;
  category: string;
  amount: number;
  currency: string;
  expenseDate: string; // ISO
  hasReceipt: boolean;
  payerName: string;
  enteredByParticipantId: string;
}

/**
 * 展示整个行程的活动流，但编辑/删除只对自己录入的那些生效——后端 PATCH/DELETE
 * 已经把 entered_by_participant_id 焊死在 WHERE 里、别人的一律 404，这里按
 * `mine` 隐藏掉那两个入口，不是靠隐藏骗用户，是避免点了才发现 404 的空转。
 */
export function ExpenseList({
  tripId,
  expenses,
  myParticipantId,
}: {
  tripId: string;
  expenses: ExpenseListItem[];
  myParticipantId: string;
}) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(expenseId: string) {
    if (!confirm('确定要删除这笔消费记录吗？这个操作不能撤销。')) return;
    setError(null);
    setDeletingId(expenseId);
    try {
      const res = await fetch(`/api/trips/${tripId}/expenses/${expenseId}`, { method: 'DELETE' });
      if (!res.ok) {
        setError('删除失败，刷新页面再试一次');
        return;
      }
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  if (expenses.length === 0) {
    return <p className="text-sm text-slate-500">还没记过账，点下面「记一笔消费」开始。</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-base text-red-600">{error}</p>}
      <ul className="flex flex-col gap-2">
        {expenses.map((e) => {
          const mine = e.enteredByParticipantId === myParticipantId;
          return (
            <li
              key={e.id}
              className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-base"
            >
              <Avatar name={e.payerName} size={28} />
              <div className="flex flex-1 flex-col">
                <span className="font-medium">{e.category}</span>
                <span className="text-xs text-slate-500">
                  {e.payerName} 垫付 · {e.expenseDate.slice(0, 10)}
                  {e.hasReceipt && ' · 有收据'}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="tabular-nums">{formatMoney(e.amount, e.currency)}</span>
                {mine && (
                  <>
                    <Link href={`/trips/${tripId}/expenses/${e.id}/edit`} className="tap-link text-sm text-slate-500">
                      编辑
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(e.id)}
                      disabled={deletingId === e.id}
                      className="tap-link text-base text-red-600 disabled:opacity-50"
                    >
                      {deletingId === e.id ? '删除中…' : '删除'}
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
