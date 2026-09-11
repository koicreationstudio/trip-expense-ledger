'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatMoney } from '@/lib/money';
import type { UserTripSummary } from '@/lib/db/user-trips-query';

/**
 * 头部导航"行程名"变成触发器，弹出紧凑下拉——DESIGN-BRIEF 第七版 D 节。
 * 只有账号名下有 2 个及以上行程时才渲染成可点按钮，只有 1 个行程（或没登录账号，
 * 单纯认领邀请进来）时退回纯文字，不给一个点了也没用的按钮。
 */
export function TripSwitcher({
  currentTripId,
  currentTripName,
  otherTrips,
}: {
  currentTripId: string;
  currentTripName: string;
  otherTrips: UserTripSummary[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  if (otherTrips.length === 0) {
    return <p className="text-[12.5px] font-semibold text-gold-dk">{currentTripName}</p>;
  }

  async function handleSwitch(tripId: string) {
    setError(null);
    setSwitchingId(tripId);
    try {
      const res = await fetch('/api/account/switch-trip', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tripId }),
      });
      if (!res.ok) {
        setError('切换失败，刷新页面再试一次');
        return;
      }
      setOpen(false);
      router.push(`/trips/${tripId}`);
      router.refresh();
    } finally {
      setSwitchingId(null);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-[32px] items-center gap-1 text-[12.5px] font-semibold text-gold-dk"
      >
        {currentTripName}
        <span className="text-[10px] text-muted" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 w-full min-w-[220px] rounded-xl border border-sand bg-paper shadow-card">
          <p className="px-[9px] pt-[9px] text-[9.5px] uppercase tracking-wide text-muted">切换行程</p>
          {error && <p className="px-[9px] pb-1 text-xs text-coral">{error}</p>}
          <ul className="flex flex-col">
            <li className="border-t border-sand px-[9px] py-[5px] bg-[rgba(164,163,160,.14)]">
              <span className="text-[12.5px] font-medium text-ink">{currentTripName}</span>
              <span className="ml-2 text-[10px] text-muted">当前行程</span>
            </li>
            {otherTrips.map((trip) => (
              <li key={trip.id} className="border-t border-sand">
                <button
                  type="button"
                  onClick={() => handleSwitch(trip.id)}
                  disabled={switchingId === trip.id}
                  className="flex w-full items-center justify-between px-[9px] py-[5px] text-left disabled:opacity-50"
                >
                  <span className="text-[12.5px] font-medium text-ink">
                    {trip.name}
                    {switchingId === trip.id && <span className="ml-2 text-[10px] text-muted">切换中…</span>}
                  </span>
                  <span
                    className={`shrink-0 text-[10px] font-medium ${
                      trip.netBalance >= 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}
                  >
                    {trip.netBalance >= 0 ? '该收' : '该付'}{' '}
                    <span className="font-serif tabular-nums">
                      {formatMoney(Math.abs(trip.netBalance), trip.baseCurrency)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Link
            href="/trips/new"
            className="block border-t border-sand px-[9px] py-[5px] text-[12.5px] text-gold-dk underline underline-offset-2"
          >
            ＋ 创建新行程
          </Link>
        </div>
      )}
    </div>
  );
}
