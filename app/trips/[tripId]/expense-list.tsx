'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2 } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { SelectDropdown } from '@/components/select-dropdown';

export interface ExpenseListItem {
  id: string;
  category: string;
  merchant: string | null;
  amount: number;
  currency: string;
  amountBaseCurrency: number;
  // fix(2026-09-19 第二十八轮，Remy 真实行程"🇭🇰2026香港"本位币=HKD、消费也全用HKD记，
  // 坐实真bug)：约算金额原本的显示条件是"e.currency !== baseCurrency"，这条行程
  // 100%两者相等，条件永远不成立，约算行永远不显示。改成"行程本位币不是MYR就显示
  // 约算"——Remy是马来西亚人，本位币不是MYR时才需要一个"换算回MYR大概多少钱"的
  // 参考数字，这个字段是服务端（page.tsx）用 lib/fx/rate-cache.ts 的实时MYR中间
  // 汇率算好、已经是MYR分为单位的值；汇率缓存/接口暂时不可用时是 null，这时不显示
  // 约算行（不拿一个算不出来的数字硬凑），不阻塞其它信息正常展示。
  amountMyr: number | null;
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
 * category 字段是自由文本，新记的账走下拉会带一个前缀 emoji（`COMMON_CATEGORIES`
 * 就是"🍜 餐饮"这种格式），但历史旧记录/用户自己手打的分类可能没有——这个 helper
 * 尽量拆出"图标 + 文字"两半，拆不出来（没有 emoji 前缀）就用一个通用图标兜底，
 * 不会因为拆不出来就整行崩掉或者显示乱码。
 */
function splitCategoryIcon(category: string): { icon: string; label: string } {
  const trimmed = category.trim();
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx > 0) {
    const maybeIcon = trimmed.slice(0, spaceIdx);
    const rest = trimmed.slice(spaceIdx + 1).trim();
    if (/\p{Extended_Pictographic}/u.test(maybeIcon) && rest.length > 0) {
      return { icon: maybeIcon, label: rest };
    }
  }
  return { icon: '🧾', label: trimmed };
}

/**
 * 展示整个行程的活动流，但编辑/删除只对自己录入的那些生效——后端 PATCH/DELETE
 * 已经把 entered_by_participant_id 焊死在 WHERE 里、别人的一律 404，这里按
 * `mine` 隐藏掉那两个入口，不是靠隐藏骗用户，是避免点了才发现 404 的空转。
 *
 * 2026-09-15 补齐 Artifact Version 10 遗留缺口——排序下拉 + 4 个筛选 chip + 约算
 * 本位币小字，这三项是真的会动的功能（真重排/真隐藏行），不是纯装饰。
 *
 * fix(2026-09-17 第二十轮，Remy 真机截图坐实"记录·HISTORY"区块整体没对齐，怀疑
 * 从没被真的检查过——查证属实，round18 全页长截图里其实拍到过这个区块，但从没
 * 有人真的拿它跟方案这一屏的 HTML/CSS 逐项核对过）：这次照方案原文重做整个行结构。
 * - 每行拆成 图标 + 名称行 + (垫付人·日期·分类·支付方式) meta 行 + 约算金额行，
 *   不再是"分类+商家挤一行、垫付人+日期挤另一行"这种跟方案对不上的排法；
 *   名称优先显示商家名（没填商家名才退回显示分类文字），分类文字挪到 meta 行，
 *   不会因为改了位置就丢信息。
 * - 约算成本位币的小字（"≈RM128.40"这种）从右侧金额栏底下挪到左侧 meta 栏下面，
 *   跟方案 `.hist-mid` 里 `.hist-approx` 紧跟在 `.hist-meta` 后面的堆叠顺序一致。
 * - 编辑/删除从常驻图标改成点这一行才展开（方案要的是"滑动或点击才出现"，上一轮
 *   评估过跨设备滑动手势风险后选点击这条路，不是偷懒不做）：点行内空白处展开右侧
 *   操作区（金额那一刻让位滑走），再点一次或者点别的行会收起。金额本身不受影响
 *   （依然一直看得到，只是宽度收窄挪个位置），不是"点开才显示金额"。
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
  // 哪一行的编辑/删除操作区正展开——同一时间只让一行展开，点别的行/再点一次
  // 当前行都会收起，不需要额外的"点击外部关闭"监听（列表本身就在页面主体里，
  // 没有浮层遮挡问题）。
  const [revealedId, setRevealedId] = useState<string | null>(null);

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
    // fix(2026-09-19 第二十八轮)：字号照方案 `.empty{font-size:11.5px}` 改（原来是
    // Tailwind `text-sm`=14px，比方案规定大，这轮只改字号，颜色/padding不在这次任务
    // 范围内不动）。
    return <p className="text-[11.5px] text-muted">还没记过账，点下面「记一笔消费」开始。</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-base text-coral">{error}</p>}

      {/* fix(2026-09-17 第二十轮)：方案原文这个区块顶部有一行说明文字（`.hist-static-note`），
          告诉用户排序里哪些是真的会动的。方案自己那份 demo 里"手动(长按拖拽)"是假的
          静态展示，日期/金额排序才是真的——这句话是照方案 demo 自身情况写的，不能照抄
          到这个真实 app 里（这里没有一项是假的，连"手动"都是真实服务器顺序，不是摆设，
          只是不支持长按拖拽调整），所以文案改成如实描述这个真实 app 自己的情况，不是
          抄方案的字面句子。 */}
      <p className="text-[9.5px] leading-[1.5] text-muted">
        💡 排序里「手动」是维持记账时的原始顺序（不能长按拖拽调整），「日期」/「金额」重排是真的会动；下面的分类/垫付人/日期/支付方式筛选也是真的会按条件隐藏不符合的记录，不是摆设。
      </p>

      {/* 排序下拉 + 4 个筛选 chip：chip 用跟 fx-channel-compare-card.tsx 目标币种
          按钮同一套 pill 视觉语言（rounded-full、chip padding 3/9px），不是纯装饰——
          选了真的会重排/隐藏下面的行。fix(2026-09-17 第二十轮，全站原生 select 根治)：
          原本是原生 `<select>`（选项一多，纯按钮组会换行占太多空间），改成
          SelectDropdown 白底弹层，跟全站自定义下拉体系统一。 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <SelectDropdown
          ariaLabel="排序方式"
          value={sortMode}
          onChange={(next) => setSortMode(next as SortMode)}
          triggerClassName="min-h-[26px] rounded-full border border-sand bg-white px-[9px] text-[10px] font-medium text-ink"
          options={[
            { value: 'manual', label: '排序：手动' },
            { value: 'date', label: '排序：日期' },
            { value: 'amount', label: '排序：金额' },
          ]}
        />
        <SelectDropdown
          ariaLabel="按分类筛选"
          value={categoryFilter}
          onChange={setCategoryFilter}
          triggerClassName="min-h-[26px] max-w-[104px] rounded-full border border-sand bg-white px-[9px] text-[10px] font-medium text-ink"
          options={[
            { value: ALL, label: '分类：全部' },
            ...categoryOptions.map((c) => ({ value: c, label: c })),
          ]}
        />
        <SelectDropdown
          ariaLabel="按垫付人筛选"
          value={payerFilter}
          onChange={setPayerFilter}
          triggerClassName="min-h-[26px] max-w-[96px] rounded-full border border-sand bg-white px-[9px] text-[10px] font-medium text-ink"
          options={[
            { value: ALL, label: '垫付人：全部' },
            ...payerOptions.map((p) => ({ value: p, label: p })),
          ]}
        />
        <SelectDropdown
          ariaLabel="按日期筛选"
          value={dateFilter}
          onChange={setDateFilter}
          triggerClassName="min-h-[26px] max-w-[100px] rounded-full border border-sand bg-white px-[9px] text-[10px] font-medium text-ink"
          options={[
            { value: ALL, label: '日期：全部' },
            ...dateOptions.map((d) => ({ value: d, label: d.slice(5) })),
          ]}
        />
        <SelectDropdown
          ariaLabel="按支付方式筛选"
          value={paymentMethodFilter}
          onChange={setPaymentMethodFilter}
          triggerClassName="min-h-[26px] max-w-[112px] rounded-full border border-sand bg-white px-[9px] text-[10px] font-medium text-ink"
          options={[
            { value: ALL, label: '支付方式：全部' },
            ...paymentMethodOptions.map((m) => ({ value: m, label: m })),
          ]}
        />
        {hasActiveFilter && (
          <button type="button" onClick={resetFilters} className="tap-link text-[10px] text-muted">
            清除筛选
          </button>
        )}
      </div>

      {visibleExpenses.length === 0 ? (
        <p className="text-xs text-muted">没有符合筛选条件的消费。</p>
      ) : (
        <ul className="flex flex-col">
          {visibleExpenses.map((e) => {
            const mine = e.enteredByParticipantId === myParticipantId;
            // fix(2026-09-19 第二十八轮)：不再拿"这一笔的币种"跟本位币比——改成"这趟
            // 行程的本位币是不是MYR"，理由见上面 ExpenseListItem.amountMyr 字段注释。
            const showConverted = baseCurrency !== 'MYR' && e.amountMyr !== null;
            const revealed = mine && revealedId === e.id;
            const { icon, label: categoryLabel } = splitCategoryIcon(e.category);
            // 名称优先显示商家名（方案原文那种"拜神"/"Bolt/Grab"式具体描述），没填
            // 商家名才退回显示分类文字——两种情况都不会让分类信息凭空消失：填了
            // 商家名时分类文字挪到下面 meta 行，没填商家名时分类文字本身就是名称。
            const primaryName = e.merchant?.trim() || categoryLabel;
            const metaParts = [e.payerName, e.expenseDate.slice(5, 10)];
            if (e.merchant?.trim()) metaParts.push(categoryLabel);
            if (e.paymentMethodLabel) metaParts.push(e.paymentMethodLabel);
            if (e.hasReceipt) metaParts.push('有收据');
            return (
              <li
                key={e.id}
                className="relative overflow-hidden border-t border-sand first:border-t-0"
              >
                {/* fix(2026-09-17 第二十轮)：整行可点（仅自己录入的行）切换编辑/删除
                    展开态，对齐方案"操作按钮是点击/滑动后才出现的隐藏态，不是常驻
                    显示"——上一轮评估过真滑动手势（跨设备行为不一致、跟 Link/按钮
                    点击区域冲突）风险比收益大没有做，点击整行展开是方案自己也认可
                    的替代方案（方案原文"滑动或点击触发"二选一）。金额区域点开后
                    往左让位，编辑/删除图标从右边滑入，靠 transform+transition 做，
                    不靠拆分组件。 */}
                <button
                  type="button"
                  disabled={!mine}
                  onClick={() => setRevealedId((prev) => (prev === e.id ? null : mine ? e.id : prev))}
                  className="flex w-full items-center gap-[7px] py-[7px] pl-[2px] pr-[4px] text-left disabled:cursor-default"
                  aria-expanded={mine ? revealed : undefined}
                  aria-label={mine ? '展开这笔消费的编辑/删除操作' : undefined}
                >
                  <span aria-hidden="true" className="w-6 shrink-0 text-center text-[15px] leading-none">
                    {icon}
                  </span>
                  {/* min-w-0 让 flex-1 子元素的 truncate 生效——没有它 flex item 默认不收缩，
                      长垫付人名字会把这一栏撑宽挤爆金额，而不是自己省略号截断。 */}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[12px] font-medium">
                      {primaryName}
                      {e.excludeFromSplit && (
                        <span className="ml-1 inline-flex items-center rounded-full bg-[rgba(184,158,97,.2)] px-[6px] py-[1px] align-middle text-[8.5px] font-medium text-muted">
                          不计分摊
                        </span>
                      )}
                    </span>
                    <span className="truncate text-[9.5px] text-muted">{metaParts.join(' · ')}</span>
                    {showConverted && (
                      <span className="font-serif text-[9.5px] tabular-nums text-muted">
                        ≈{formatMoney(e.amountMyr!, 'MYR')}
                      </span>
                    )}
                  </div>
                  <span
                    className={`shrink-0 font-serif text-[12.5px] font-semibold tabular-nums transition-transform duration-150 ${
                      revealed ? '-translate-x-[62px]' : 'translate-x-0'
                    }`}
                  >
                    {formatMoney(e.amount, e.currency)}
                  </span>
                </button>
                {mine && (
                  <div
                    className={`absolute right-[4px] top-0 flex h-full items-center gap-1 bg-gradient-to-l from-paper from-[65%] to-transparent pl-[22px] transition-transform duration-150 ${
                      revealed ? 'translate-x-0' : 'translate-x-[120%]'
                    }`}
                  >
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
