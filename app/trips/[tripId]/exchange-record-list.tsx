'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { ConfirmDialog } from '@/components/confirm-dialog';

export interface ExchangeRecordItem {
  id: string;
  fromLabel: string | null;
  toLabel: string;
  fromAmount: number | null;
  toAmount: number;
  fromCurrency: string;
  toCurrency: string;
  exchangeDate: string; // ISO
  note: string | null;
}

/** 隐含汇率 = toAmount / fromAmount，现算不存值，避免展示值跟金额本身对不上。 */
function impliedRateLabel(item: ExchangeRecordItem): string | null {
  if (item.fromAmount === null || item.fromAmount === 0) return null;
  const rate = item.toAmount / item.fromAmount;
  return `1 ${item.fromCurrency} ≈ ${rate.toFixed(4)} ${item.toCurrency}`;
}

/**
 * 换汇记录删除（2026-09-18 第二十三轮补的真实功能缺口）：这份数据之前完全没有
 * 删除能力（route.ts 只有 GET/POST），这轮新增了
 * `DELETE /api/trips/{tripId}/exchange-records/{id}` 端点，删除时会把这笔记录
 * 对双边钱包余额造成的净影响原样撤回（见那个 route.ts 顶部大段注释，讲清楚了
 * 为什么"反向抵消"在这个 app 的余额模型下等价于"从没发生过"，不需要级联重算）。
 *
 * 这个组件之前是纯展示的 server component（没有 'use client'），这次改成
 * client component 才能挂状态/事件；page.tsx 那边保持 server component 不变，
 * 只是多传一个 tripId 下来。
 */
export function ExchangeRecordList({ tripId, records }: { tripId: string; records: ExchangeRecordItem[] }) {
  const router = useRouter();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function performDelete() {
    if (!confirmingId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/exchange-records/${confirmingId}`, { method: 'DELETE' });
      if (!res.ok) {
        setDeleteError('删除失败，请稍后再试。');
        setConfirmingId(null);
        return;
      }
      setConfirmingId(null);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  if (records.length === 0) {
    // fix(2026-09-19 第二十八轮)：字号照方案 `.empty{font-size:11.5px}` 改（原来是
    // Tailwind `text-sm`=14px，比方案规定大，这轮只改字号，颜色/padding不在这次任务
    // 范围内不动）。
    return <p className="text-[11.5px] text-muted">还没有换汇记录，点上面「取款 / 换汇」开始记。</p>;
  }

  return (
    <>
      <ul className="flex flex-col gap-2">
        {records.map((r) => {
          const rateLabel = impliedRateLabel(r);
          return (
            <li key={r.id} className="tx-item">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-circle text-sm"
                aria-hidden="true"
              >
                🔁
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[12.5px] font-medium">
                  {r.fromLabel ?? '充值'} → {r.toLabel}
                </span>
                <span className="mt-0.5 truncate border-t border-dashed border-sand pt-0.5 text-[10px] text-muted">
                  {rateLabel ?? r.exchangeDate.slice(5, 10)}
                  {r.note && ` · ${r.note}`}
                </span>
              </div>
              <span className="shrink-0 font-serif text-[12.5px] font-medium tabular-nums">
                {formatMoney(r.toAmount, r.toCurrency)}
              </span>
              {/* 跟支付方式页「已配置的支付方式」同一个 🗑 图标语义——这里没有编辑能力
                  (换汇记录本身没有编辑端点，跟这轮补删除是两件事)，只补删除。
                  fix(独立 ui-auditor 手机端实测坐实同一类问题)：这一行是正常宽度的
                  `.tx-item`，不像钱包胶囊那样挤，直接照 expense-list.tsx 编辑/删除图标
                  同一套 `min-h-[28px] min-w-[28px]`（DESIGN-BRIEF.md 第204行"toolbar icon
                  button 28×28px"基准），图标本身视觉尺寸不变。 */}
              <button
                type="button"
                onClick={() => {
                  setDeleteError(null);
                  setConfirmingId(r.id);
                }}
                aria-label="删除这笔换汇记录"
                className="inline-flex min-h-[28px] min-w-[28px] shrink-0 items-center justify-center text-muted transition-colors hover:text-coral"
              >
                <Trash2 className="h-[13px] w-[13px]" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      {deleteError && <p className="text-[10px] text-coral">{deleteError}</p>}
      <ConfirmDialog
        open={confirmingId !== null}
        message="确定要删除这笔换汇记录吗？关联的两个钱包余额会按这笔记录的金额自动回滚，这个操作不能撤销。"
        confirmLabel={deleting ? '删除中…' : '删除'}
        onConfirm={performDelete}
        onCancel={() => setConfirmingId(null)}
      />
    </>
  );
}
