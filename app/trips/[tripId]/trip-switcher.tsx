'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatMoney } from '@/lib/money';
import type { UserTripSummary } from '@/lib/db/user-trips-query';
import { ConfirmDialog } from '@/components/confirm-dialog';

/**
 * 头部导航"行程名"变成触发器，弹出紧凑下拉——DESIGN-BRIEF 第七版 D 节。
 * 只有账号名下有 2 个及以上行程，或者当前用户是这趟行程的 owner（owner 需要
 * 删除入口，哪怕名下只有这一个行程）时才渲染成可点按钮；两者都不满足（没登录
 * 账号，单纯认领邀请进来的非 owner 同行人）退回纯文字，不给一个点了也没用的按钮。
 *
 * fix(2026-09-12 加删除行程)：面板里原本只有"切换行程"一段，现在 owner 视角下
 * 底部多一段"删除此行程"（只有 owner 才渲染，非 owner 完全看不到这个入口，
 * API 层 DELETE /api/trips/[tripId] 也用 withTripOwner 做同样鉴权，不是只在
 * 前端藏按钮）。caption 文字按有没有其它行程可切换动态换：有得切就是"切换行程"，
 * 没有（只剩管理动作）就是"管理行程"。
 */
export function TripSwitcher({
  currentTripId,
  currentTripName,
  otherTrips,
  isOwner,
}: {
  currentTripId: string;
  currentTripName: string;
  otherTrips: UserTripSummary[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
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

  // fix(2026-09-12 标题栏走查反馈)：这是每个子页面顶部唯一真正的"行程标题"（下面
  // page.tsx 那个重复的 <h1> 已经拿掉），原本 12.5px 跟其它次级文字同一档，读起来
  // 不像标题。改成 text-lg font-bold，跟 "记一笔消费"这类页面 h1（text-base）比也
  // 更大更重，撑得起"标题栏"这个角色。
  const canOpenPanel = otherTrips.length > 0 || isOwner;
  if (!canOpenPanel) {
    return <p className="text-lg font-bold text-gold-dk">{currentTripName}</p>;
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

  // 删除当前行程：DB 记录 + 关联数据（消费/钱包/参与者…）由 schema.ts 的
  // onDelete: cascade 自动清空，这里只管调 API + 决定删完跳去哪。
  // 名下还有别的行程就换到其中一个（走现成的 switch-trip，铸一个指向那趟行程
  // 的新 session——当前这条 tel_session 背后的 participant 行已经跟着 trip
  // 一起被级联删掉，不能留着继续用）；一个都不剩就退回首页，首页会按账号
  // （tel_user_session，跟被删的 trip 无关，不受影响）重新查"我的行程"列表。
  async function handleDeleteConfirmed() {
    if (deleting) return; // ConfirmDialog 没有内建 disabled 态，自己挡一下重复点击/双发请求
    setError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/trips/${currentTripId}`, { method: 'DELETE' });
      if (!res.ok) {
        setError('删除失败，刷新页面再试一次');
        setConfirmOpen(false);
        return;
      }

      setConfirmOpen(false);
      setOpen(false);

      const nextTrip = otherTrips[0];
      if (nextTrip) {
        const switchRes = await fetch('/api/account/switch-trip', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tripId: nextTrip.id }),
        });
        if (switchRes.ok) {
          router.push(`/trips/${nextTrip.id}`);
          router.refresh();
          return;
        }
      }
      router.push('/');
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-[32px] items-center gap-1 text-lg font-bold text-gold-dk"
      >
        {currentTripName}
        <span className="text-sm text-muted" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 w-full min-w-[220px] rounded-xl border border-sand bg-paper shadow-card">
          <p className="px-[9px] pt-[9px] text-[9.5px] uppercase tracking-wide text-muted">
            {otherTrips.length > 0 ? '切换行程' : '管理行程'}
          </p>
          {error && <p className="px-[9px] pb-1 text-[10px] text-coral">{error}</p>}
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
                      trip.netBalance >= 0 ? 'text-positive' : 'text-negative'
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
          {isOwner && (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="block w-full border-t border-sand px-[9px] py-[5px] text-left text-[12.5px] text-coral"
            >
              🗑 删除此行程
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        message={`确定要删除「${currentTripName}」吗？这趟行程下所有消费记录、钱包、换汇记录、参与者都会一起永久清空，无法恢复。`}
        confirmLabel={deleting ? '删除中…' : '删除'}
        cancelLabel="取消"
        variant="danger"
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
