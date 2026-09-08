'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus } from 'lucide-react';

/**
 * 全站最高频动作的常驻入口，固定在屏幕底部方便单手拇指点到。
 * 在记消费/编辑消费页面本身不显示——那两个页面已经有自己的提交按钮，
 * 再叠一个功能重复的入口只会跟提交按钮挤在一起、增加误触。
 */
export function RecordExpenseFab({ tripId }: { tripId: string }) {
  const pathname = usePathname();
  const onFormPage =
    pathname.includes('/expenses/new') || pathname.includes('/edit') || pathname.includes('/exchange/new');

  if (onFormPage) return null;

  return (
    <div
      className="fixed right-4 z-10"
      style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
    >
      <Link
        href={`/trips/${tripId}/expenses/new`}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-accent-700 px-4 text-base font-medium text-white shadow-lg transition-colors hover:bg-accent-800"
      >
        <Plus className="h-5 w-5" aria-hidden="true" />
        记一笔消费
      </Link>
    </div>
  );
}
