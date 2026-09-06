'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * 全站最高频动作的常驻入口，固定在屏幕底部方便单手拇指点到。
 * 在记消费/编辑消费页面本身不显示——那两个页面已经有自己的提交按钮，
 * 再叠一个功能重复的入口只会跟提交按钮挤在一起、增加误触。
 */
export function RecordExpenseFab({ tripId }: { tripId: string }) {
  const pathname = usePathname();
  const onExpenseForm = pathname.includes('/expenses/new') || pathname.includes('/edit');

  if (onExpenseForm) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 px-4 pt-3 backdrop-blur [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-3xl">
        <Link href={`/trips/${tripId}/expenses/new`} className="btn-primary w-full">
          + 记一笔消费
        </Link>
      </div>
    </div>
  );
}
