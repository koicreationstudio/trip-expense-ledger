'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2, GripVertical } from 'lucide-react';
import { formatMoney, centsToYuan } from '@/lib/money';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { SelectDropdown, useDismissableOpen } from '@/components/select-dropdown';
import { moveItem, isSameOrder } from '@/lib/domain/reorder';
import {
  isSameExpenseListPreference,
  type ExpenseListPreferenceSnapshot,
} from '@/lib/domain/expense-list-preference-diff';
import {
  matchesAmountRange,
  matchesAmountExact,
  parseAmountYuanInput,
  type AmountFilterMode,
} from '@/lib/domain/expense-amount-filter';

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
  // 2026-09-26 第七十一轮任务⑤新增："手动排序"模式下的顺序，服务端已经按这个
  // 字段排过一次（page.tsx 现在改成按 sortOrder 传下来，见下面组件里的用法），
  // 这里只是同一份数据在前端拖拽时的排序基准。
  sortOrder: number;
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

  // 第 6 个筛选 chip「金额」——跟上面 4 个不一样，故意**不**接进下面
  // expense-list-preference 那套 D1 云端存档（另一条并行任务正在改那套持久化
  // 机制的落地方式，这次故意不碰 `lib/domain/expense-list-preference-diff.ts`/
  // `app/api/trips/[tripId]/expense-list-preference/route.ts` 这两个文件，避免
  // 跟它冲突）。这几个 state 单纯是本地 useState，刷新页面/换设备不保留，跟
  // 团队看板/PENDING-DECISIONS 里"这轮金额筛选先只做前端"的范围一致。
  // - `amountFilterMode`：区间/精确 两种模式二选一。
  // - `amountMinInput`/`amountMaxInput`：区间模式两个输入框的原始文字（"元"，
  //   不是分）——保留成字符串而不是 number，是因为用户打字过程中会经过
  //   "1"→"1."→"1.5" 这类还没解析成合法数字的中间状态，不能用 number 存。
  // - `amountExactInput`：精确模式单一输入框的原始文字。
  const [amountFilterMode, setAmountFilterMode] = useState<AmountFilterMode>('range');
  const [amountMinInput, setAmountMinInput] = useState('');
  const [amountMaxInput, setAmountMaxInput] = useState('');
  const [amountExactInput, setAmountExactInput] = useState('');
  const [amountFilterOpen, setAmountFilterOpen] = useState(false);
  // 点空白/Escape 关闭这个面板——跟 fx-compare-card.tsx「⚙自选比较项」同一个
  // 共用 hook，面板形状（模式切换+两个输入框）套不进 SelectDropdown 的 value/
  // onChange 单选模型，不硬套。
  const amountFilterContainerRef = useDismissableOpen(amountFilterOpen, () => setAmountFilterOpen(false));

  // 哪一行的编辑/删除操作区正展开——同一时间只让一行展开，点别的行/再点一次
  // 当前行都会收起，不需要额外的"点击外部关闭"监听（列表本身就在页面主体里，
  // 没有浮层遮挡问题）。
  const [revealedId, setRevealedId] = useState<string | null>(null);

  // fix(2026-09-26 第七十一轮，任务⑥)：排序模式 + 4 个筛选条件云端同步，跟
  // fx-compare-card.tsx 完全同一套"零交互不 PUT"双保险——`hasUserInteractedRef`
  // 只在下面四个筛选下拉/排序下拉的 onChange 真实入口置 true，组件挂载、从 D1
  // 恢复存档这类派生 setState 一律不会碰它；`lastSavedSnapshotRef` 是发 PUT 前
  // 再跟"已知最新存档内容"比一遍的第二层双保险。两层写法完全照抄
  // fx-compare-card.tsx，不重新发明。
  const hasUserInteractedRef = useRef(false);
  function markUserInteracted() {
    hasUserInteractedRef.current = true;
  }
  const lastSavedSnapshotRef = useRef<ExpenseListPreferenceSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadPreference() {
      try {
        const res = await fetch(`/api/trips/${tripId}/expense-list-preference`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          preference: {
            sortMode: string;
            categoryFilter: string;
            payerFilter: string;
            dateFilter: string;
            paymentMethodFilter: string;
          } | null;
        };
        const saved = data.preference;
        if (cancelled) return;
        lastSavedSnapshotRef.current = saved
          ? {
              sortMode: saved.sortMode,
              categoryFilter: saved.categoryFilter,
              payerFilter: saved.payerFilter,
              dateFilter: saved.dateFilter,
              paymentMethodFilter: saved.paymentMethodFilter,
            }
          : null;
        if (!saved) return;
        // 优雅降级：存的筛选值如果这趟行程现在已经没有对应的候选项了（比如那个
        // 分类/那个人已经不在筛选候选池里），悄悄忽略，继续用 ALL，不阻塞渲染。
        // 这些 setState 都是"恢复存档"，不是用户操作，不能碰 hasUserInteractedRef。
        if (saved.sortMode === 'manual' || saved.sortMode === 'date' || saved.sortMode === 'amount') {
          setSortMode(saved.sortMode);
        }
        if (saved.categoryFilter) setCategoryFilter(saved.categoryFilter);
        if (saved.payerFilter) setPayerFilter(saved.payerFilter);
        if (saved.dateFilter) setDateFilter(saved.dateFilter);
        if (saved.paymentMethodFilter) setPaymentMethodFilter(saved.paymentMethodFilter);
      } catch {
        // 拉取失败静默走默认值，不阻塞列表渲染。
      }
    }
    void loadPreference();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  useEffect(() => {
    if (!hasUserInteractedRef.current) return;
    const timer = setTimeout(() => {
      const nextSnapshot: ExpenseListPreferenceSnapshot = {
        sortMode,
        categoryFilter,
        payerFilter,
        dateFilter,
        paymentMethodFilter,
      };
      if (isSameExpenseListPreference(lastSavedSnapshotRef.current, nextSnapshot)) return;
      lastSavedSnapshotRef.current = nextSnapshot;
      void fetch(`/api/trips/${tripId}/expense-list-preference`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(nextSnapshot),
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [tripId, sortMode, categoryFilter, payerFilter, dateFilter, paymentMethodFilter]);

  // fix(2026-09-26 第七十一轮，任务⑤)：手动排序拖拽。`serverManualOrder` 是服务端
  // 按 sortOrder 排好的基准顺序（页面刷新/新增删除消费后 `expenses` prop 变化时
  // 自动跟着变）；`dragOrderOverride` 是这次拖拽会话里的乐观顺序，落位后 PATCH
  // 成功、`router.refresh()` 带回新的 `expenses` prop 时靠下面这个 effect 清空，
  // 重新信任服务端顺序（不会一直用本地覆盖值，避免跟服务端真相脱节）。
  const serverManualOrder = useMemo(
    () => [...expenses].sort((a, b) => a.sortOrder - b.sortOrder).map((e) => e.id),
    [expenses]
  );
  const [dragOrderOverride, setDragOrderOverride] = useState<string[] | null>(null);
  useEffect(() => {
    setDragOrderOverride(null);
  }, [expenses]);
  const manualOrder = dragOrderOverride ?? serverManualOrder;

  const itemRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const dragStateRef = useRef<{
    pointerId: number;
    orderAtStart: string[];
    longPressTimer: ReturnType<typeof setTimeout> | null;
    armed: boolean;
    startClientY: number;
  } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  async function commitReorder(nextOrder: string[]) {
    setDragOrderOverride(nextOrder);
    if (isSameOrder(nextOrder, serverManualOrder)) return;
    try {
      const res = await fetch(`/api/trips/${tripId}/expenses/reorder`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderedExpenseIds: nextOrder }),
      });
      if (!res.ok) {
        setError('调整顺序失败，刷新页面再试一次');
        setDragOrderOverride(null);
        return;
      }
      router.refresh();
    } catch {
      setError('调整顺序失败，刷新页面再试一次');
      setDragOrderOverride(null);
    }
  }

  function handleDragMove(clientY: number) {
    const state = dragStateRef.current;
    if (!state || !state.armed || draggingId === null) return;
    const currentOrder = dragOrderOverride ?? state.orderAtStart;
    const fromIndex = currentOrder.indexOf(draggingId);
    if (fromIndex === -1) return;
    // 拿指针当前 Y 坐标去跟每一行的中点比，落在哪一行的中点上方/下方决定目标下标——
    // 不用命中判定整行范围，逐行中点比较对短行/长行都稳定，也不需要考虑指针
    // 有没有精确停在某个元素的可点击区域内。
    let targetIndex = fromIndex;
    for (let i = 0; i < currentOrder.length; i++) {
      const el = itemRefs.current[currentOrder[i]!];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (clientY < mid) {
        targetIndex = i;
        break;
      }
      targetIndex = i;
    }
    if (targetIndex === fromIndex) return;
    setDragOrderOverride(moveItem(currentOrder, fromIndex, targetIndex));
  }

  function endDrag() {
    const state = dragStateRef.current;
    if (state?.longPressTimer) clearTimeout(state.longPressTimer);
    dragStateRef.current = null;
    if (draggingId !== null && dragOrderOverride) {
      void commitReorder(dragOrderOverride);
    }
    setDraggingId(null);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>, expenseId: string) {
    if (dragDisabled) return;
    const orderAtStart = manualOrder;
    const startClientY = e.clientY;
    const isTouch = e.pointerType === 'touch';

    function arm() {
      dragStateRef.current = {
        pointerId: e.pointerId,
        orderAtStart,
        longPressTimer: null,
        armed: true,
        startClientY,
      };
      setDraggingId(expenseId);
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    }

    if (isTouch) {
      // 手机长按拖拽：先记一个"待激活"状态，等 350ms 计时器真的触发才算拖拽开始
      // （给普通点击/滑动列表留出识别窗口，不是一碰手柄就误触发拖拽）。
      const timer = setTimeout(() => {
        arm();
      }, 350);
      dragStateRef.current = { pointerId: e.pointerId, orderAtStart, longPressTimer: timer, armed: false, startClientY };
    } else {
      // 电脑按住拖：鼠标/触控笔按下即可开始，不需要长按等待。
      arm();
    }
  }

  function handlePointerMoveOnHandle(e: React.PointerEvent<HTMLButtonElement>) {
    const state = dragStateRef.current;
    if (!state) return;
    if (!state.armed) {
      // 长按计时器还没触发时指针已经明显移动（判定为滚动/误触），取消这次待激活。
      if (Math.abs(e.clientY - state.startClientY) > 10) {
        if (state.longPressTimer) clearTimeout(state.longPressTimer);
        dragStateRef.current = null;
      }
      return;
    }
    handleDragMove(e.clientY);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    endDrag();
  }

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

  // 金额筛选要比大小的那个"换算参考值"——跟上面 `showConverted`（约算行要不要
  // 显示）同一条判断：行程本位币不是 MYR 时用 amountMyr（服务端已经算好的 MYR
  // 参考值），本位币是 MYR 时这笔消费的 amountBaseCurrency 本身就是 MYR 记账值，
  // 直接当"这个用户熟悉的那个基准货币数字"用，两种情况统一后不同原币种的消费
  // 才能放进同一个区间比较。
  const amountMinCents = useMemo(() => parseAmountYuanInput(amountMinInput), [amountMinInput]);
  const amountMaxCents = useMemo(() => parseAmountYuanInput(amountMaxInput), [amountMaxInput]);
  const amountExactCents = useMemo(() => parseAmountYuanInput(amountExactInput), [amountExactInput]);
  const isAmountFilterActive =
    amountFilterMode === 'range' ? amountMinCents !== null || amountMaxCents !== null : amountExactCents !== null;

  const visibleExpenses = useMemo(() => {
    const filtered = expenses.filter((e) => {
      if (categoryFilter !== ALL && e.category !== categoryFilter) return false;
      if (payerFilter !== ALL && e.payerName !== payerFilter) return false;
      if (dateFilter !== ALL && e.expenseDate.slice(0, 10) !== dateFilter) return false;
      if (paymentMethodFilter !== ALL && (e.paymentMethodLabel ?? '未指定') !== paymentMethodFilter) return false;
      if (isAmountFilterActive) {
        // 跟上面 `showConverted`（约算行要不要显示）同一条判断：行程本位币不是
        // MYR 时用 amountMyr（服务端已经算好的 MYR 参考值），本位币是 MYR 时这笔
        // 消费的 amountBaseCurrency 本身就是 MYR 记账值，直接当"这个用户熟悉的
        // 那个基准货币数字"用，两种情况统一后不同原币种的消费才能放进同一个
        // 区间比较。
        const convertedCents = baseCurrency !== 'MYR' ? e.amountMyr : e.amountBaseCurrency;
        const filterable = { amountCents: e.amount, convertedCents };
        if (amountFilterMode === 'range') {
          if (!matchesAmountRange(filterable, { minCents: amountMinCents, maxCents: amountMaxCents })) return false;
        } else if (amountExactCents === null || !matchesAmountExact(filterable, amountExactCents)) {
          return false;
        }
      }
      return true;
    });
    if (sortMode === 'date') {
      return [...filtered].sort((a, b) => b.expenseDate.localeCompare(a.expenseDate));
    }
    if (sortMode === 'amount') {
      return [...filtered].sort((a, b) => b.amountBaseCurrency - a.amountBaseCurrency);
    }
    // 'manual'：按 sortOrder（或这次拖拽会话里的乐观顺序）排，不再是"props 传进来
    // 的原始顺序"——2026-09-26 第七十一轮任务⑤之前，manual 模式其实等价于服务端
    // 默认的按日期排序，现在真的可以拖拽调整了，要按 `manualOrder` 这份显式顺序
    // 来，不能继续假设 props 顺序天然正确。
    const orderIndex = new Map(manualOrder.map((id, i) => [id, i]));
    return [...filtered].sort(
      (a, b) => (orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    );
  }, [
    expenses,
    sortMode,
    categoryFilter,
    payerFilter,
    dateFilter,
    paymentMethodFilter,
    manualOrder,
    baseCurrency,
    isAmountFilterActive,
    amountFilterMode,
    amountMinCents,
    amountMaxCents,
    amountExactCents,
  ]);

  const hasActiveFilter =
    categoryFilter !== ALL ||
    payerFilter !== ALL ||
    dateFilter !== ALL ||
    paymentMethodFilter !== ALL ||
    isAmountFilterActive;

  // fix(2026-09-26 第七十一轮，任务⑤)：开着筛选时列表只显示部分消费，此时拖拽
  // 调整的"相对顺序"跟实际存的全量顺序会脱节（用户看到的是收窄过的子集，以为
  // 拖到最上面，实际在全量顺序里未必真的排最前）——禁止拖拽 + 引导"清空筛选才能
  // 调整顺序"比允许一个会让人困惑的局部拖拽更安全，这是任务书原文明确要求的边界。
  const dragDisabled = sortMode !== 'manual' || hasActiveFilter;

  // 「金额」chip 按钮上要显示的文字——没开这个筛选就是纯文字"金额"，开了按当前
  // 模式显示具体数值（跟其它 chip"分类：xxx"这种带当前值的展示习惯一致），用
  // 元（不是分）显示，两位小数对齐全站金额展示习惯。
  const amountChipLabel = (() => {
    if (amountFilterMode === 'exact') {
      return amountExactCents !== null ? `金额：=${centsToYuan(amountExactCents).toFixed(2)}` : '金额';
    }
    if (amountMinCents !== null && amountMaxCents !== null) {
      return `金额：${centsToYuan(amountMinCents).toFixed(2)}–${centsToYuan(amountMaxCents).toFixed(2)}`;
    }
    if (amountMinCents !== null) return `金额：≥${centsToYuan(amountMinCents).toFixed(2)}`;
    if (amountMaxCents !== null) return `金额：≤${centsToYuan(amountMaxCents).toFixed(2)}`;
    return '金额';
  })();

  function resetFilters() {
    markUserInteracted();
    setCategoryFilter(ALL);
    setPayerFilter(ALL);
    setDateFilter(ALL);
    setPaymentMethodFilter(ALL);
    // 金额筛选不接云端存档（见上面 state 声明处的注释），这里只是清一下本地
    // 输入框内容，不涉及 hasUserInteractedRef/PUT 那条链路。
    setAmountMinInput('');
    setAmountMaxInput('');
    setAmountExactInput('');
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
          抄方案的字面句子。
          fix(2026-09-26 第七十一轮，任务⑤，Remy 明确要求"拖拽支持")：手动排序现在
          真的可以拖拽调整了（电脑按住拖/手机长按拖），文案改回如实描述这个新状态；
          开着筛选时拖拽会被禁用（见下面 dragDisabled），这句也提一句。 */}
      <p className="text-[9.5px] leading-[1.5] text-muted">
        💡 排序「手动」时可以拖拽调整顺序（电脑按住拖，手机长按拖，开着筛选时暂不能拖）；「日期」/「金额」重排是真的会动；下面的分类/垫付人/日期/支付方式/金额筛选也是真的会按条件隐藏不符合的记录，不是摆设。
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
          onChange={(next) => {
            markUserInteracted();
            setSortMode(next as SortMode);
          }}
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
          onChange={(next) => {
            markUserInteracted();
            setCategoryFilter(next);
          }}
          triggerClassName="min-h-[26px] max-w-[104px] rounded-full border border-sand bg-white px-[9px] text-[10px] font-medium text-ink"
          options={[
            { value: ALL, label: '分类：全部' },
            ...categoryOptions.map((c) => ({ value: c, label: c })),
          ]}
        />
        <SelectDropdown
          ariaLabel="按垫付人筛选"
          value={payerFilter}
          onChange={(next) => {
            markUserInteracted();
            setPayerFilter(next);
          }}
          triggerClassName="min-h-[26px] max-w-[96px] rounded-full border border-sand bg-white px-[9px] text-[10px] font-medium text-ink"
          options={[
            { value: ALL, label: '垫付人：全部' },
            ...payerOptions.map((p) => ({ value: p, label: p })),
          ]}
        />
        <SelectDropdown
          ariaLabel="按日期筛选"
          value={dateFilter}
          onChange={(next) => {
            markUserInteracted();
            setDateFilter(next);
          }}
          triggerClassName="min-h-[26px] max-w-[100px] rounded-full border border-sand bg-white px-[9px] text-[10px] font-medium text-ink"
          options={[
            { value: ALL, label: '日期：全部' },
            ...dateOptions.map((d) => ({ value: d, label: d.slice(5) })),
          ]}
        />
        <SelectDropdown
          ariaLabel="按支付方式筛选"
          value={paymentMethodFilter}
          onChange={(next) => {
            markUserInteracted();
            setPaymentMethodFilter(next);
          }}
          triggerClassName="min-h-[26px] max-w-[112px] rounded-full border border-sand bg-white px-[9px] text-[10px] font-medium text-ink"
          options={[
            { value: ALL, label: '支付方式：全部' },
            ...paymentMethodOptions.map((m) => ({ value: m, label: m })),
          ]}
        />
        {/* 「金额」筛选 chip——跟上面 4 个不同，不是单选下拉，是"区间/精确"两种
            模式各自带输入框的面板，套不进 SelectDropdown 的 value/onChange 单选
            模型，改用跟 fx-compare-card.tsx「⚙自选比较项」同一套手搓面板 +
            `useDismissableOpen` 共用 hook（点空白/Escape 关闭）。 */}
        <div ref={amountFilterContainerRef} className="relative">
          <button
            type="button"
            onClick={() => setAmountFilterOpen((v) => !v)}
            aria-expanded={amountFilterOpen}
            className="min-h-[26px] max-w-[120px] truncate rounded-full border border-sand bg-white px-[9px] text-[10px] font-medium text-ink"
          >
            {amountChipLabel} ▾
          </button>
          {amountFilterOpen && (
            <div className="absolute left-0 top-full z-10 mt-1 w-[220px] rounded-[10px] border border-sand bg-white p-2 shadow-card">
              {/* 区间/精确 模式切换——跟 expense-form.tsx「怎么分？」那组分摊子模式
                  同一套胶囊双态切换视觉（选中态 bg-ink 反白，未选中态白底黑字）。 */}
              <div className="flex gap-[5px]">
                {(
                  [
                    { value: 'range', label: '区间' },
                    { value: 'exact', label: '精确' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setAmountFilterMode(opt.value)}
                    aria-pressed={amountFilterMode === opt.value}
                    className={
                      amountFilterMode === opt.value
                        ? 'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-ink px-[7px] py-[4px] text-[10px] font-medium text-white transition-colors'
                        : 'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-sand bg-white px-[7px] py-[4px] text-[10px] font-medium text-ink transition-colors hover:opacity-80'
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {amountFilterMode === 'range' ? (
                <div className="mt-2 flex items-end gap-[6px]">
                  <label className="flex flex-1 flex-col gap-[3px]">
                    <span className="field-label">最低</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      placeholder="不限"
                      value={amountMinInput}
                      onChange={(e) => setAmountMinInput(e.target.value)}
                      className="field-input w-full"
                    />
                  </label>
                  <span className="pb-[6px] text-[10px] text-muted">–</span>
                  <label className="flex flex-1 flex-col gap-[3px]">
                    <span className="field-label">最高</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      placeholder="不限"
                      value={amountMaxInput}
                      onChange={(e) => setAmountMaxInput(e.target.value)}
                      className="field-input w-full"
                    />
                  </label>
                </div>
              ) : (
                <label className="mt-2 flex flex-col gap-[3px]">
                  <span className="field-label">金额等于</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    placeholder="填原币金额或约算值都可以"
                    value={amountExactInput}
                    onChange={(e) => setAmountExactInput(e.target.value)}
                    className="field-input w-full"
                  />
                </label>
              )}
              {isAmountFilterActive && (
                <button
                  type="button"
                  onClick={() => {
                    setAmountMinInput('');
                    setAmountMaxInput('');
                    setAmountExactInput('');
                  }}
                  className="tap-link mt-1 text-[9.5px] text-muted"
                >
                  清除金额筛选
                </button>
              )}
            </div>
          )}
        </div>
        {hasActiveFilter && (
          <button type="button" onClick={resetFilters} className="tap-link text-[10px] text-muted">
            清除筛选
          </button>
        )}
      </div>

      {/* fix(2026-09-26 第七十一轮，任务⑤)：开着筛选时拖拽手柄整组隐藏（不是显示
          但点了没反应那种半失效状态），这里提示一句为什么拖不动，别让用户以为
          拖拽功能坏了。 */}
      {sortMode === 'manual' && hasActiveFilter && (
        <p className="text-[9.5px] text-muted">清除筛选之后才能拖拽调整顺序。</p>
      )}

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
                ref={(el) => {
                  itemRefs.current[e.id] = el;
                }}
                className={`relative flex items-stretch overflow-hidden border-t border-sand first:border-t-0 ${
                  draggingId === e.id ? 'bg-[rgba(164,163,160,.14)]' : ''
                }`}
              >
                {/* fix(2026-09-26 第七十一轮，任务⑤，Remy 明确要求"拖拽支持")：
                    手动排序模式 + 没有筛选时才显示拖拽手柄。电脑按住手柄拖（鼠标/
                    触控笔按下即开始），手机长按手柄 350ms 拖（给普通滚动手势留出
                    识别窗口，不是一碰就误触发）。手柄本身是一颗独立的小按钮，不是
                    整行都能拖——整行已经被"点击展开编辑/删除"占用，两个手势混在
                    同一块区域会互相打架，分开一颗专属手柄更清楚。 */}
                {!dragDisabled && (
                  <button
                    type="button"
                    aria-label="拖拽调整顺序"
                    className="flex shrink-0 cursor-grab touch-none items-center justify-center px-[2px] text-muted active:cursor-grabbing"
                    onPointerDown={(evt) => handlePointerDown(evt, e.id)}
                    onPointerMove={handlePointerMoveOnHandle}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                  >
                    <GripVertical className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
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
                  className="flex min-w-0 flex-1 items-center gap-[7px] py-[7px] pl-[2px] pr-[4px] text-left disabled:cursor-default"
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
                        <span className="ml-1 inline-flex items-center rounded-full bg-[rgba(164,163,160,.2)] px-[6px] py-[1px] align-middle text-[8.5px] font-medium text-muted">
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
