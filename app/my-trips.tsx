'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatMoney } from '@/lib/money';

export interface MyTripCard {
  id: string;
  name: string;
  baseCurrency: string;
  status: string;
  isOwner: boolean;
  netBalance: number;
}

const STATUS_LABEL: Record<string, string> = {
  active: '记账中',
  settled: '已结算',
  archived: '已归档',
};

/**
 * 点卡片不是直接跳转（首页的 tel_user_session 不能直接访问只认 tel_session 的
 * trip 页面），而是先打 switch-trip 铸一个新的 tel_session 指向这个 trip，
 * 成功后再跳转。查不到关联（理论上不会发生，除非数据被删了）会拿到 404，
 * 提示一下就好，不用特殊处理。
 */
export function MyTrips({ trips }: { trips: MyTripCard[] }) {
  const router = useRouter();
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleOpen(tripId: string) {
    setError(null);
    setSwitchingId(tripId);
    try {
      const res = await fetch('/api/account/switch-trip', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tripId }),
      });
      if (!res.ok) {
        setError('打开这个行程失败，刷新页面再试一次');
        return;
      }
      router.push(`/trips/${tripId}`);
    } finally {
      setSwitchingId(null);
    }
  }

  if (trips.length === 0) {
    return <p className="text-sm text-muted">还没建过行程，点上面「创建新行程」开始。</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-base text-coral">{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {trips.map((trip) => (
          <button
            key={trip.id}
            type="button"
            onClick={() => handleOpen(trip.id)}
            disabled={switchingId === trip.id}
            className="flex flex-col gap-1 rounded-xl border border-sand bg-paper p-4 text-left text-base hover:border-muted disabled:opacity-50"
          >
            <span className="font-medium">{trip.name}</span>
            <span className="text-xs text-muted">
              本位币 {trip.baseCurrency} · {trip.isOwner ? '创建者' : '同行人'} ·{' '}
              {STATUS_LABEL[trip.status] ?? trip.status}
            </span>
            <span
              className={`text-sm font-medium ${
                trip.netBalance >= 0 ? 'text-emerald-600' : 'text-red-600'
              }`}
            >
              {trip.netBalance >= 0 ? '该收' : '该付'}{' '}
              <span className="font-serif tabular-nums">
                {formatMoney(Math.abs(trip.netBalance), trip.baseCurrency)}
              </span>
            </span>
            {switchingId === trip.id && <span className="text-xs text-muted">打开中…</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
