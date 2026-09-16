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
  tripStartDate: string | null;
  tripEndDate: string | null;
}

function formatDateRange(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  };
  if (start && end) return `${fmt(start)} - ${fmt(end)}`;
  return fmt((start ?? end)!);
}

// fix(2026-09-17 第十九轮，独立 ui-auditor 盲测坐实)：Artifact 这一屏三个 chip
// （币种/身份/状态）统一是同一个 `.chip{background:#fff;color:gold-dk}` 白底灰字样式，
// 状态没有单独的彩色区分——之前"记账中"接了 DESIGN-BRIEF.md 第五版定的 ok/live
// 三态色（跟结算页"有效/已确认"这类进度徽章共用配色），在这一屏跟另外两个 chip
// 风格不统一，是真差异。这次首页卡片的状态 chip 改回跟另外两个一样的中性配色，
// ok/live 这套色板本身没有废弃，继续给结算/邀请管理那些真正表达"进度"的徽章用。
const STATUS_LABEL: Record<string, string> = {
  active: '记账中',
  settled: '已结算',
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
          {/* fix(2026-09-16 第十八轮)：颜色本来就跟 gold-dk 同色号，补上 letter-spacing
              对齐 Artifact `section.blk h4` 完整规格（这次全站统一扫的同一批）。 */}
          {showSectionLabels && (
            <h2 className="text-[10px] font-medium tracking-[0.08em] text-muted">进行中</h2>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {activeTrips.map((trip) => (
              <TripCard key={trip.id} trip={trip} switching={switchingId === trip.id} onOpen={handleOpen} />
            ))}
          </div>
        </div>
      )}
      {endedTrips.length > 0 && (
        <div className="flex flex-col gap-2">
          {showSectionLabels && (
            <h2 className="text-[10px] font-medium tracking-[0.08em] text-muted">已结束</h2>
          )}
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
  const router = useRouter();
  const statusLabel = STATUS_LABEL[trip.status];
  const dateRange = formatDateRange(trip.tripStartDate, trip.tripEndDate);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(trip.name);
  const [saving, setSaving] = useState(false);

  async function handleSaveName() {
    const next = nameDraft.trim();
    if (!next || next === trip.name) {
      setEditing(false);
      setNameDraft(trip.name);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/trips/${trip.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: next }),
      });
      if (res.ok) {
        setEditing(false);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  // fix(2026-09-13 Artifact Version 10 落地，第四轮拍板屏①)：卡片本身是可点开的
  // <button>，改名 ✎ 图标必须是独立控件——两个 <button> 不能互相嵌套（无效 HTML），
  // 改成外层 relative 容器 + 卡片按钮 + 绝对定位的编辑图标按钮，图标点击
  // stopPropagation 不让事件冒泡触发卡片的 onOpen。
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpen(trip.id)}
        disabled={switching}
        className={`flex w-full flex-col gap-1 rounded-[14px] border border-sand px-[10px] py-2 text-left text-[12.5px] hover:border-muted disabled:opacity-50 ${
          ended ? 'bg-paper opacity-70' : 'bg-[rgba(164,163,160,.14)] shadow-card'
        }`}
      >
        {/* fix(2026-09-17 第十九轮)：Artifact 卡片内字段顺序是"标题→标签行→日期行→金额"，
            之前是"标题→日期行→标签行→金额"，日期和标签顺序反了——这次对调，同时把
            三个标签统一成同一个 `.chip` 白底灰字样式（原本"创建者/同行人"是裸文字，
            不是 chip；币种是灰底 chip；这次三个都用同一套 pill 外观，跟 Artifact 三个
            chip 视觉统一一致）。 */}
        <span className="pr-5 font-medium">{trip.name}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-[9.5px] text-muted">
          <span className="inline-flex items-center rounded-full border border-sand bg-white px-[7px] py-[1px] font-mono font-medium text-muted">
            {trip.baseCurrency}
          </span>
          <span className="inline-flex items-center rounded-full border border-sand bg-white px-[7px] py-[1px] font-medium text-muted">
            {trip.isOwner ? '创建者' : '同行人'}
          </span>
          <span className="inline-flex items-center rounded-full border border-sand bg-white px-[7px] py-[1px] font-medium text-muted">
            {statusLabel ?? ARCHIVED_LABEL}
          </span>
        </span>
        {dateRange && <span className="text-[10px] text-muted">📅 {dateRange}</span>}
        <span
          className={`text-[12.5px] font-medium ${
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
            总消费{' '}
            <span className="font-serif tabular-nums">
              {formatMoney(trip.totalExpenseBaseCurrency, trip.baseCurrency)}
            </span>{' '}
            · {trip.expenseCount} 笔
          </span>
        )}
        {switching && <span className="text-[10px] text-muted">打开中…</span>}
      </button>

      {trip.isOwner && !editing && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setNameDraft(trip.name);
            setEditing(true);
          }}
          aria-label={`改名「${trip.name}」`}
          className="absolute right-2 top-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] text-muted hover:text-ink"
        >
          ✎
        </button>
      )}

      {editing && (
        <div
          className="absolute inset-0 z-10 flex flex-col justify-center gap-1.5 rounded-[14px] border border-sand bg-paper p-[9px] shadow-card"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            className="field-input"
            placeholder="行程名称"
          />
          <div className="flex items-center gap-2">
            <button type="button" disabled={saving} onClick={handleSaveName} className="btn-secondary">
              {saving ? '保存中…' : '保存'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setNameDraft(trip.name);
              }}
              className="tap-link text-[11px] text-muted"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
