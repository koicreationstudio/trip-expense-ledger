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
  totalExpenseBaseCurrency: number;
  expenseCount: number;
}

// 状态从裸文字换成 pill（DESIGN-BRIEF.md 第五版已定案、settlement/invites-manager 已落地的
// ok/live 三态色，首页只是接上这套现成的东西）。archived 没有对应色阶，
// 降级成 text-muted 灰阶裸文字，不强套 pill（同一份简报视觉决定第3条）。
const STATUS_PILL: Record<string, { label: string; className: string }> = {
  active: { label: '记账中', className: 'bg-live-bg text-live' },
  settled: { label: '已结算', className: 'bg-ok-bg text-ok' },
};
const ARCHIVED_LABEL = '已归档';

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
    return (
      <p className="text-[12.5px] text-muted">
        还没建过行程。「消费记录」帮你把出差账记清楚——同行人代垫的钱怎么分、这笔该用哪张卡最划算，都算给你看。点上面「创建新行程」开始第一趟。
      </p>
    );
  }

  // 分两个视觉层级，不是三个并列分组：进行中正常权重在上，已结算/已归档降级权重在下
  // （简报视觉决定第2条）。同一组内按"余额优先"原则，欠得越多/该收越多的越靠前。
  const activeTrips = trips
    .filter((trip) => trip.status === 'active')
    .sort((a, b) => Math.abs(b.netBalance) - Math.abs(a.netBalance));
  const endedTrips = trips
    .filter((trip) => trip.status !== 'active')
    .sort((a, b) => Math.abs(b.netBalance) - Math.abs(a.netBalance));
  // 只有一组有内容时不显示分节标题，避免"标题下面空空如也"的空组。
  const showSectionLabels = activeTrips.length > 0 && endedTrips.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="rounded-xl border border-sand bg-[rgba(164,163,160,.14)] px-[9px] py-[5px] text-[10px] text-coral">
          {error}
        </p>
      )}
      {activeTrips.length > 0 && (
        <div className="flex flex-col gap-2">
          {showSectionLabels && <h2 className="text-[10px] font-medium text-muted">进行中</h2>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {activeTrips.map((trip) => (
              <TripCard key={trip.id} trip={trip} switching={switchingId === trip.id} onOpen={handleOpen} />
            ))}
          </div>
        </div>
      )}
      {endedTrips.length > 0 && (
        <div className="flex flex-col gap-2">
          {showSectionLabels && <h2 className="text-[10px] font-medium text-muted">已结束</h2>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {endedTrips.map((trip) => (
              <TripCard key={trip.id} trip={trip} switching={switchingId === trip.id} onOpen={handleOpen} ended />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TripCard({
  trip,
  switching,
  onOpen,
  ended = false,
}: {
  trip: MyTripCard;
  switching: boolean;
  onOpen: (tripId: string) => void;
  ended?: boolean;
}) {
  const statusPill = STATUS_PILL[trip.status];
  return (
    <button
      type="button"
      onClick={() => onOpen(trip.id)}
      disabled={switching}
      className={`flex flex-col gap-1 rounded-xl border border-sand px-[9px] py-2 text-left text-base hover:border-muted disabled:opacity-50 ${
        ended ? 'bg-paper opacity-70' : 'bg-[rgba(164,163,160,.14)] shadow-card'
      }`}
    >
      <span className="font-medium">{trip.name}</span>
      <span className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
        <span className="inline-flex items-center rounded-full bg-sand px-[7px] py-[1px] font-mono text-[9.5px] font-medium text-muted">
          {trip.baseCurrency}
        </span>
        <span>{trip.isOwner ? '创建者' : '同行人'}</span>
        {statusPill ? (
          <span className={`inline-flex items-center rounded-full px-[9px] py-[3px] text-[9.5px] font-medium ${statusPill.className}`}>
            {statusPill.label}
          </span>
        ) : (
          <span>{ARCHIVED_LABEL}</span>
        )}
      </span>
      <span
        className={`text-sm font-medium ${
          trip.netBalance >= 0 ? 'text-positive' : 'text-negative'
        }`}
      >
        {trip.netBalance >= 0 ? '该收' : '该付'}{' '}
        <span className="font-serif tabular-nums">
          {formatMoney(Math.abs(trip.netBalance), trip.baseCurrency)}
        </span>
      </span>
      {trip.expenseCount > 0 && (
        <span className="text-[10px] text-muted">
          总消费 {formatMoney(trip.totalExpenseBaseCurrency, trip.baseCurrency)} · {trip.expenseCount} 笔
        </span>
      )}
      {switching && <span className="text-[10px] text-muted">打开中…</span>}
    </button>
  );
}
