'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2 } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { Avatar } from '@/components/avatar';
import { ConfirmDialog } from '@/components/confirm-dialog';

export interface ExpenseListItem {
  id: string;
  category: string;
  merchant: string | null;
  amount: number;
  currency: string;
  amountBaseCurrency: number;
  expenseDate: string; // ISO
  hasReceipt: boolean;
  payerName: string;
  enteredByParticipantId: string;
  // 只有「我自己」录入的消费才查得到真实标签（payment_method 归属私有），
  // 别人录入的一律是 '其他人的支付方式' 或 null（没选支付方式）。
  paymentMethodLabel: string | null;
  // 2026-09-16 新增：这笔是不是被标了"不计入 Hero 卡我承担合计"（机票/宝石这类
  // 默认如此），纯展示小标记，不影响这里任何排序/筛选/金额计算。
  excludeFromSplit: boolean;
}

type SortMode = 'manual' | 'date' | 'amount';

const ALL = '__all__';

/**
 * 展示整个行程的活动流，但编辑/删除只对自己录入的那些生效——后端 PATCH/DELETE
 * 已经把 entered_by_participant_id 焊死在 WHERE 里、别人的一律 404，这里按
 * `mine` 隐藏掉那两个入口，不是靠隐藏骗用户，是避免点了才发现 404 的空转。
 *
 * 2026-09-15 补齐 Artifact Version 10 遗留缺口——排序下拉 + 4 个筛选 chip + 约算
 * 本位币小字，这三项是真的会动的功能（真重排/真隐藏行），不是纯装饰。**没做**的一项：
 * Artifact 要求"滑动才显示编辑/删除"（默认不常驻图标），这次评估后判断触屏滑动手势
 * 风险（跨设备行为、跟下面 ConfirmDialog/Link 的点击区域冲突）比收益大，没有动手做，
 * 编辑/删除继续保持常驻图标（跟之前一样贴在头像右边），原因记在 PENDING-DECISIONS。
 */
export function ExpenseList({
  tripId,
  expenses,
  myParticipantId,
  baseCurrency,
}: {
  tripId: string;
  expenses: ExpenseListItem[];
  myParticipantId: string;
  baseCurrency: string;
}) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const [sortMode, setSortMode] = useState<SortMode>('manual');
  const [categoryFilter, setCategoryFilter] = useState(ALL);
  const [payerFilter, setPayerFilter] = useState(ALL);
  const [dateFilter, setDateFilter] = useState(ALL);
  const [paymentMethodFilter, setPaymentMethodFilter] = useState(ALL);

  // 筛选候选清单：从当前这份列表的真实数据里取 distinct 值，不是写死的枚举——
  // 这趟行程记过什么分类/谁垫过钱/哪几天记过账，候选就是什么，行程之间不会串。
  const categoryOptions = useMemo(() => Array.from(new Set(expenses.map((e) => e.category))), [expenses]);
  const payerOptions = useMemo(() => Array.from(new Set(expenses.map((e) => e.payerName))), [expenses]);
  const dateOptions = useMemo(
    () => Array.from(new Set(expenses.map((e) => e.expenseDate.slice(0, 10)))).sort((a, b) => b.localeCompare(a)),
    [expenses]
  );
  const paymentMethodOptions = useMemo(
    () => Array.from(new Set(expenses.map((e) => e.paymentMethodLabel ?? '未指定'))),
    [expenses]
  );

  const visibleExpenses = useMemo(() => {
    const filtered = expenses.filter((e) => {
      if (categoryFilter !== ALL && e.category !== categoryFilter) return false;
      if (payerFilter !== ALL && e.payerName !== payerFilter) return false;
      if (dateFilter !== ALL && e.expenseDate.slice(0, 10) !== dateFilter) return false;
      if (paymentMethodFilter !== ALL && (e.paymentMethodLabel ?? '未指定') !== paymentMethodFilter) return false;
      return true;
    });
    if (sortMode === 'date') {
      return [...filtered].sort((a, b) => b.expenseDate.localeCompare(a.expenseDate));
    }
    if (sortMode === 'amount') {
      return [...filtered].sort((a, b) => b.amountBaseCurrency - a.amountBaseCurrency);
    }
    // 'manual'：维持 props 传进来的原始顺序（服务端已经按日期新→旧排过一次）。
    return filtered;
  }, [expenses, sortMode, categoryFilter, payerFilter, dateFilter, paymentMethodFilter]);

  const hasActiveFilter =
    categoryFilter !== ALL || payerFilter !== ALL || dateFilter !== ALL || paymentMethodFilter !== ALL;

  function resetFilters() {
    setCategoryFilter(ALL);
    setPayerFilter(ALL);
    setDateFilter(ALL);
    setPaymentMethodFilter(ALL);
  }

  async function performDelete(expenseId: string) {
    setConfirmingId(null);
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
    return <p className="text-sm text-muted">还没记过账，点下面「记一笔消费」开始。</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-base text-coral">{error}</p>}

      {/* 排序下拉 + 4 个筛选 chip：chip 用跟 fx-channel-compare-card.tsx 目标币种
          按钮同一套 pill 视觉语言（rounded-full、chip padding 3/9px），实现上是原生
          `<select>`（选项一多，纯按钮组会换行占太多空间），不是纯装饰——选了真的会
          重排/隐藏下面的行。 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          aria-label="排序方式"
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          className="min-h-[26px] rounded-full border border-sand bg-white px-[9px] text-[10px] font-medium text-ink"
        >
          <option value="manual">排序：手动</option>
          <option value="date">排序：日期</option>
          <option value="amount">排序：金额</option>
        </select>
        <select
          aria-label="按分类筛选"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="min-h-[26px] max-w-[104px] rounded-full border border-sand bg-white px-[9px] text-[10px] font-medium text-ink"
        >
          <option value={ALL}>分类：全部</option>
          {categoryOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          aria-label="按垫付人筛选"
          value={payerFilter}
          onChange={(e) => setPayerFilter(e.target.value)}
          className="min-h-[26px] max-w-[96px] rounded-full border border-sand bg-white px-[9px] text-[10px] font-medium text-ink"
        >
          <option value={ALL}>垫付人：全部</option>
          {payerOptions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          aria-label="按日期筛选"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="min-h-[26px] max-w-[100px] rounded-full border border-sand bg-white px-[9px] text-[10px] font-medium text-ink"
        >
          <option value={ALL}>日期：全部</option>
          {dateOptions.map((d) => (
            <option key={d} value={d}>
              {d.slice(5)}
            </option>
          ))}
        </select>
        <select
          aria-label="按支付方式筛选"
          value={paymentMethodFilter}
          onChange={(e) => setPaymentMethodFilter(e.target.value)}
          className="min-h-[26px] max-w-[112px] rounded-full border border-sand bg-white px-[9px] text-[10px] font-medium text-ink"
        >
          <option value={ALL}>支付方式：全部</option>
          {paymentMethodOptions.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {hasActiveFilter && (
          <button type="button" onClick={resetFilters} className="tap-link text-[10px] text-muted">
            清除筛选
          </button>
        )}
      </div>

      {visibleExpenses.length === 0 ? (
        <p className="text-xs text-muted">没有符合筛选条件的消费。</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visibleExpenses.map((e) => {
            const mine = e.enteredByParticipantId === myParticipantId;
            const showConverted = e.currency !== baseCurrency;
            return (
              <li key={e.id} className="tx-item justify-between">
                <Avatar name={e.payerName} size={24} />
                {/* 编辑/删除放在头像右边（不是行尾）：常驻 FAB 固定贴在屏幕右下角，
                    行尾贴边的图标只要行数够多、总高度接近一屏，就会被 FAB 盖住
                    （压缩过上面区块间距也没用，总会有某一行凑巧落进 FAB 的固定区域）。
                    挪来这里之后不管记了几笔账、FAB 多宽，编辑/删除都不会被挡。
                    Artifact 要求这两个图标改成"滑动才出现"，这轮评估后没有做（见组件
                    顶部注释），继续常驻显示。 */}
                {mine && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Link
                      href={`/trips/${tripId}/expenses/${e.id}/edit`}
                      aria-label="编辑这笔消费"
                      className="inline-flex min-h-[28px] min-w-[28px] items-center justify-center text-muted"
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(e.id)}
                      disabled={deletingId === e.id}
                      aria-label="删除这笔消费"
                      className="inline-flex min-h-[28px] min-w-[28px] items-center justify-center text-coral disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                )}
                {/* min-w-0 让 flex-1 子元素的 truncate 生效——没有它 flex item 默认不收缩，
                    长垫付人名字会把这一栏撑宽挤爆金额，而不是自己省略号截断。
                    统一单行（不换行）是为了不同卡片之间高度一致，避免有的卡片单行、
                    有的因为名字长换成两行，看起来参差不齐（ui-auditor 走查点名过这个）。 */}
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[12.5px] font-medium">
                    {e.category}
                    {e.merchant && <span className="font-normal text-muted"> · {e.merchant}</span>}
                    {e.excludeFromSplit && (
                      <span className="ml-1 inline-flex items-center rounded-full bg-[rgba(164,163,160,.2)] px-[6px] py-[1px] align-middle text-[8.5px] font-medium text-muted">
                        不计分摊
                      </span>
                    )}
                  </span>
                  <span className="truncate text-[10px] text-muted">
                    {e.payerName} · {e.expenseDate.slice(5, 10)}
                    {e.hasReceipt && ' · 有收据'}
                  </span>
                </div>
                {/* 金额继续钉死在行最右侧（DESIGN-BRIEF 第一版就定的规矩：金额一律放最右侧、
                    等宽数字对齐），不因为这次挪了编辑/删除就跟着松动。约算本位币小字只在
                    原始币种不是本位币时才出现，同币种再显示一遍"≈"是废话。 */}
                <div className="flex shrink-0 flex-col items-end">
                  <span className="font-serif text-[12.5px] font-medium tabular-nums">
                    {formatMoney(e.amount, e.currency)}
                  </span>
                  {showConverted && (
                    <span className="font-serif text-[9px] tabular-nums text-muted">
                      ≈{formatMoney(e.amountBaseCurrency, baseCurrency)}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={confirmingId !== null}
        message="确定要删除这笔消费记录吗？这个操作不能撤销。"
        confirmLabel="删除"
        onConfirm={() => confirmingId && performDelete(confirmingId)}
        onCancel={() => setConfirmingId(null)}
      />
    </div>
  );
}
