'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatMoney } from '@/lib/money';

export interface ExpenseListItem {
  id: string;
  category: string;
  amount: number;
  currency: string;
  expenseDate: string; // ISO
  hasReceipt: boolean;
}

/**
 * 只展示"我的消费记录"，删除/编辑都只对自己录入的这条生效——后端 DELETE/PATCH
 * 已经把 entered_by_participant_id 焊死在 WHERE 里，这里不用也不能传别人的 id。
 */
export function ExpenseList({ tripId, expenses }: { tripId: string; expenses: ExpenseListItem[] }) {
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
    return <p className="text-sm text-slate-500">还没记过账，点上面「记一笔」开始。</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ul className="flex flex-col gap-2">
        {expenses.map((e) => (
          <li
            key={e.id}
            className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <div className="flex flex-col">
              <span className="font-medium">{e.category}</span>
              <span className="text-xs text-slate-500">
                {e.expenseDate.slice(0, 10)}
                {e.hasReceipt && ' · 有收据'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span>{formatMoney(e.amount, e.currency)}</span>
              <Link href={`/trips/${tripId}/expenses/${e.id}/edit`} className="text-xs text-slate-500 underline">
                编辑
              </Link>
              <button
                type="button"
                onClick={() => handleDelete(e.id)}
                disabled={deletingId === e.id}
                className="text-xs text-red-600 underline disabled:opacity-50"
              >
                {deletingId === e.id ? '删除中…' : '删除'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
