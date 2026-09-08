'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2 } from 'lucide-react';
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
              {/* min-w-0 让 flex-1 子元素的 truncate 生效——没有它 flex item 默认不收缩，
                  长垫付人名字会把这一栏撑宽挤爆金额/编辑/删除，而不是自己省略号截断。
                  统一单行（不换行）是为了不同卡片之间高度一致，避免有的卡片单行、
                  有的因为名字长换成两行，看起来参差不齐（ui-auditor 走查点名过这个）。 */}
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{e.category}</span>
                <span className="truncate text-xs text-slate-500">
                  {e.payerName} · {e.expenseDate.slice(5, 10)}
                  {e.hasReceipt && ' · 有收据'}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span className="tabular-nums">{formatMoney(e.amount, e.currency)}</span>
                {mine && (
                  <>
                    {/* 编辑/删除改图标按钮（而不是"编辑"/"删除"文字链接）：横向空间比第一版紧张
                        （多了头像 + 垫付人副标题），文字链接会把中间栏挤到换行，图标更省宽度。
                        44px 最小热区靠 padding 撑，不是靠图标本身大小。 */}
                    <Link
                      href={`/trips/${tripId}/expenses/${e.id}/edit`}
                      aria-label="编辑这笔消费"
                      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-slate-500"
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(e.id)}
                      disabled={deletingId === e.id}
                      aria-label="删除这笔消费"
                      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-red-600 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
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
