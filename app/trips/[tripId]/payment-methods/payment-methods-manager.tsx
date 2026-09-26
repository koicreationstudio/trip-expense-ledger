'use client';

import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PAYMENT_METHOD_SETTLEMENT_CURRENCIES } from '@/lib/currencies';
import { yuanToCents, centsToYuan, formatMoney } from '@/lib/money';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { SelectDropdown } from '@/components/select-dropdown';
import { Switch } from '@/components/switch';
import { MissingWalletRow, type CreatedWalletDto } from '../missing-wallet-row';
import {
  formatThousands,
  stripThousands,
  countMeaningfulCharsBefore,
  positionForMeaningfulCount,
} from '@/lib/format-thousands';

interface PaymentMethod {
  id: string;
  label: string;
  kind: 'card' | 'cash';
  settlementCurrency: string;
  fxMarkupPercent: number;
  foreignTxnFeePercent: number;
  fixedFee: number;
  cashbackPercent: number;
  isActive: boolean;
  sortOrder: number;
  // 这趟行程是否勾了「启用」（2026-09-15 落地 Artifact Version 10 遗留缺口）。
  enabled: boolean;
}

interface Wallet {
  id: string;
  label: string;
  currency: string;
  emoji: string;
  currentBalance: number;
  balanceUpdatedAt: string | null;
  // 这个钱包有没有绑某个支付方式——「设置当前余额」面板要靠这个字段过滤，
  // 只显示没绑支付方式的钱包 + 绑了「本行程启用」的支付方式的钱包。
  paymentMethodId: string | null;
}

/** 「设置当前余额」只读历史轨迹的一条（2026-09-26 新增），字段对应 lib/http/dto.ts
 * 的 `toWalletBalanceHistoryDto`。`changedByParticipantId` 接口带了但列表渲染
 * 不显示——Remy 明确要求这轮别出现"由谁设置"这种操作者文字。 */
interface WalletBalanceHistoryEntry {
  id: string;
  amount: number;
  effectiveDate: string;
  changedByParticipantId: string;
  changedAt: string;
  prevAmount: number | null;
  prevEffectiveDate: string | null;
  displayBalanceBefore: number;
  displayBalanceAfter: number;
}

const emptyForm = {
  label: '',
  kind: 'card' as 'card' | 'cash',
  settlementCurrency: PAYMENT_METHOD_SETTLEMENT_CURRENCIES[0] as string,
  fxMarkupPercent: '0',
  foreignTxnFeePercent: '0',
  fixedFeeYuan: '0',
  cashbackPercent: '0',
};

export function PaymentMethodsManager({
  tripId,
  defaultOpenBalancePanel = false,
}: {
  tripId: string;
  // fix(2026-09-23 第三十八轮)：钱包卡"去支付方式手动设置余额"深链落地时直接展开这个
  // 面板，不用让人自己找到底部那颗折叠按钮点开。
  defaultOpenBalancePanel?: boolean;
}) {
  const router = useRouter();
  const [methods, setMethods] = useState<PaymentMethod[] | null>(null);
  const [form, setForm] = useState(emptyForm);
  // 「点名字进入编辑态」改名（round72b）：只在"已配置的支付方式"这一份账号级清单上
  // 加编辑入口——下面"本行程启用的支付方式"那份清单的 `m.label` 是 `<label htmlFor>`
  // 指向勾选开关的可点击目标，改名按钮跟"点文字=切开关"这个语义冲突，两份清单显示的
  // 是同一个 `PaymentMethod.label`，改一处、`loadMethods()` 刷新后另一处自然同步，
  // 不需要重复做一份编辑入口。
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState('');
  const [labelSaving, setLabelSaving] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);
  // fix(第六十八轮，任务 J)："固定费（结算币种，元）"——`form` 是个多字段对象，
  // 这个 ref/pending 只服务 `form.fixedFeeYuan` 这一个字段，跟 `form` 里其它
  // 字段（百分比/币种/名称）无关。
  const fixedFeeInputRef = useRef<HTMLInputElement>(null);
  const pendingFixedFeeCursorRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const pendingCount = pendingFixedFeeCursorRef.current;
    if (pendingCount === null) return;
    pendingFixedFeeCursorRef.current = null;
    const input = fixedFeeInputRef.current;
    if (!input) return;
    const displayValue = formatThousands(form.fixedFeeYuan);
    const pos = positionForMeaningfulCount(displayValue, pendingCount);
    input.setSelectionRange(pos, pos);
  }, [form.fixedFeeYuan]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // 「设置当前余额」（2026-09-13 落地第四轮拍板屏⑤）：这一步操作的其实是
  // trip-level 的 wallets（这趟行程里具体每张卡/现金的余额），不是这份账号级
  // paymentMethods（那份只存汇率加点/手续费这类费率配置，本身没有余额字段）。
  // 判断依据：schema.ts 里 paymentMethods 表完全没有余额相关列，wallets 表才有
  // currentBalance；Artifact 把这个功能画在"支付方式"页只是信息架构上的归类，
  // 不代表底层数据也要挂在 paymentMethods 上——硬凑一个不存在的字段反而是错的。
  const [wallets, setWallets] = useState<Wallet[] | null>(null);
  const [editingWalletId, setEditingWalletId] = useState<string | null>(null);
  const [balanceYuan, setBalanceYuan] = useState('');
  // fix(第六十八轮，任务 J)："当前余额"输入框——虽然渲染在 `visibleWallets.map` 循环
  // 里，但 `editingWalletId` 同时只会等于一个钱包 id，任一时刻最多只有一份这个 input
  // 真的挂载在 DOM 上（其它钱包行走的是 `editingWalletId !== w.id` 的"设置"按钮分支，
  // 不渲染 input），所以不需要像 expense-form.tsx/quick-add-expense.tsx 那样按
  // participant id 建 ref 映射，单一 ref 就够。
  const balanceInputRef = useRef<HTMLInputElement>(null);
  const pendingBalanceCursorRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const pendingCount = pendingBalanceCursorRef.current;
    if (pendingCount === null) return;
    pendingBalanceCursorRef.current = null;
    const input = balanceInputRef.current;
    if (!input) return;
    const displayValue = formatThousands(balanceYuan);
    const pos = positionForMeaningfulCount(displayValue, pendingCount);
    input.setSelectionRange(pos, pos);
  }, [balanceYuan]);
  const [balanceDate, setBalanceDate] = useState('');
  const [balanceSubmitting, setBalanceSubmitting] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  // fix(2026-09-14 Artifact Version 10 走查补做)：Artifact 里"设置当前余额"是页面
  // 底部一颗按钮，点开才展开钱包余额清单——不是像这里之前那样常驻在页面最上面的一整块。
  const [balancePanelOpen, setBalancePanelOpen] = useState(defaultOpenBalancePanel);

  // 防覆盖确认流程（2026-09-26 新增，三步：①看当前锚点+现余额 ②填新值 ③确认改前→
  // 改后再真正提交）——`balanceStep` 只在 `editingWalletId` 非空时有意义，`form` 是
  // 步骤①②合并的同一屏（先看锚点信息、同一屏往下填新值），`confirm` 是步骤③。
  const [balanceStep, setBalanceStep] = useState<'form' | 'confirm'>('form');
  // 步骤①要看的"当前锚点+系统算出的现余额"——GET /wallets 那份列表已经把
  // currentBalance 换成推导出来的显示值（withDisplayBalance），原始锚点数字早被
  // 盖掉了，只有专门查一次 balance-preview（不带新值）才能拿到 prevAmount/
  // prevEffectiveDate 这两个原始值，所以这里要单独一份 state + 单独一次请求。
  const [anchorInfo, setAnchorInfo] = useState<{
    prevAmount: number | null;
    prevEffectiveDate: string | null;
    displayBalanceBefore: number;
  } | null>(null);
  const [anchorInfoLoading, setAnchorInfoLoading] = useState(false);
  // 步骤③要看的"改后系统算出的现余额"——点"下一步"那一刻带着用户填的新值再查一次
  // 同一个 balance-preview 端点算出来，跟真正 PATCH 落库时用的是同一个
  // `computeWalletDisplayBalance`，不是另外拼一套算法猜的数字。
  const [confirmPreview, setConfirmPreview] = useState<{ displayBalanceAfter: number } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  // 历史记录只读展示（2026-09-26 新增）——按钱包 id 各自缓存一份列表，展开哪个钱包
  // 的历史就用哪个 id 当 key，`undefined` = 还没查过，`null` 会不出现（查过就是数组，
  // 哪怕是空数组）。点击历史条目本身不做任何事（不预填表单、没有"恢复"按钮），
  // 这轮 Remy 明确要求只做只读展示，交互留给下一份设计稿。
  const [historyOpenWalletId, setHistoryOpenWalletId] = useState<string | null>(null);
  const [historyLoadingId, setHistoryLoadingId] = useState<string | null>(null);
  const [historyByWallet, setHistoryByWallet] = useState<Record<string, WalletBalanceHistoryEntry[]>>({});

  // fix(2026-09-24 第三十九轮，第四版，真正的根因——前三版都在"时机"上找，找错了
  // 维度）：用 Playwright 在生产环境实机插桩 `Element.prototype.scrollIntoView`
  // （记录每次调用时目标元素的 `getBoundingClientRect` + 调用前后 `window.scrollY`），
  // 逐毫秒还原真实时间线坐实：这个 effect 本身的触发时机、依赖数组、调用参数从第二版
  // 起就没有问题——`wallets`/`methods` 双双非空后确实会准时触发，触发那一刻用
  // `getBoundingClientRect` 量出来的目标绝对位置（877px）也是对的、跟最终布局一致。
  // **真正卡住的原因是纯几何限制，不是时机**：这个面板此时的
  // `document.documentElement.scrollHeight` 只有 1125px（就 1 个钱包、几张卡片，内容
  // 本来不长），视口高度 844px，浏览器能滚动的距离上限是 `1125-844=281px`——跟历次
  // 复测卡住不动的那个位置分毫不差。`scrollIntoView({block:'start'})` 想把一个已经
  // 接近页面末尾的区块顶到视口最上面，但页面剩余的"可滚动余量"物理上不够，浏览器只能
  // 滚到底就不动了，不管重试几次、时机多准都没用。已用同一份生产代码实测验证：往
  // `document.body` 尾部插一个 100vh 占位块，同一次 `scrollIntoView` 调用立刻能精确
  // 滚到 `elTop≈0`——这条"内容短+block:'start' 就是滚不到位"的根因诊断本身完全正确，
  // 下面第七十一轮第二版沿用这个诊断，只是不再用"造一块占位"来解决它（原因见下）。
  // fix(2026-09-26 第七十一轮第二版，ui-auditor 真机走查抓到"占位块方案本身就有
  // 结构性缺陷"——第一版把补多少可滚动余量从写死 100vh 改成"按缺口精算"，缺口本身
  // 算得对（比如实测场景算出 724px，不是无脑一整屏），但只要这趟行程内容够短（这个
  // 面板本身就是最后一节，后面没有别的内容了），"缺口"这个数字**本来就等于**
  // "要凭空造出多少像素的空白才能把目标顶到视口最上面"——不管这个数字算得多精确，
  // 造出来的空间除了让 `scrollIntoView({block:'start'})` 有地方可滚之外，没有任何
  // 真实内容填充，滚动结束后原样留在页面底下变成一整块空白，真机走查实测跟第一版
  // 之前的 h-screen 版本是同一类问题，只是块头小一点、没那么离谱。
  //
  // 真正的修法不是"更精确地造空白"，是**不造空白**：只有当目标区块之后剩余的
  // 真实内容本来就够长（>= 一屏）时，`block:'start'` 才用得上（这时候滚到"目标
  // 顶部=视口顶部"，视口下方全是真实内容，没有空白问题，维持第三十九轮原本的
  // 处理方式）；内容本来就短（这趟行程钱包/支付方式配得少）时，改成直接滚到
  // **页面真实的最底部**（不额外撑高文档，`window.scrollTo` 用的是当下真实的
  // `scrollHeight`，没有任何占位 div），这样目标区块自然会尽量往视口上方走、
  // 但不会把目标顶到视口最顶端那个精确位置——这是有意的取舍：目标"能看到、看到
  // 全部"比"精确顶到最顶端"更重要，两者在内容够短时没法同时满足，第一版为了强求
  // 后者才引入了不可避免的人造空白。
  useEffect(() => {
    if (!defaultOpenBalancePanel || wallets === null || methods === null) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById('set-balance');
      if (!target) return;
      const viewportHeight = window.innerHeight;
      const scrollHeight = document.documentElement.scrollHeight;
      const targetTop = target.getBoundingClientRect().top + window.scrollY;
      const realContentBelowTarget = scrollHeight - targetTop;
      if (realContentBelowTarget >= viewportHeight) {
        target.scrollIntoView({ block: 'start' });
      } else {
        window.scrollTo({ top: Math.max(0, scrollHeight - viewportHeight) });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [defaultOpenBalancePanel, wallets, methods]);

  async function loadMethods() {
    // 走行程范围的端点（不是账号范围的 /api/payment-methods）：这份响应每条支付方式
    // 多带一个 `enabled` 布尔——是不是勾了「本行程启用」，下面的启用勾选区块、
    // 记账下拉的过滤都靠这个字段，不是账号级端点能提供的。
    const res = await fetch(`/api/trips/${tripId}/payment-methods`);
    if (res.ok) {
      const data = (await res.json()) as any;
      setMethods(data.paymentMethods);
    }
  }

  async function loadWallets() {
    const res = await fetch(`/api/trips/${tripId}/wallets`);
    if (res.ok) {
      const data = (await res.json()) as any;
      setWallets(data.wallets);
    }
  }

  useEffect(() => {
    loadMethods();
    loadWallets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startEditBalance(w: Wallet) {
    setEditingWalletId(w.id);
    setBalanceStep('form');
    setBalanceYuan(String(centsToYuan(w.currentBalance)));
    // fix(2026-09-26，防覆盖确认流程)：故意不预填今天——之前默认填今天，人容易顺手
    // 直接点保存，选错日期（该扣的消费没扣到）没有任何提醒。这里留空，逼着用户
    // 自己主动点一天，配合下面的说明文字"这天之前的消费不会再扣，选错会影响历史
    // 计算"，「下一步」也会在没选日期时直接挡下来（见 handleGoToConfirm）。
    setBalanceDate('');
    setBalanceError(null);
    setAnchorInfo(null);
    setConfirmPreview(null);
    void loadAnchorInfo(w.id);
  }

  /**
   * 步骤①要看的"当前锚点+系统算出的现余额"——不带任何新值地查一次 balance-preview，
   * 纯读、不写库。见该端点顶部注释：GET /wallets 那份列表里的 `currentBalance` 早被
   * 换成推导出来的显示值，原始锚点数字只有这里才拿得到。
   */
  async function loadAnchorInfo(walletId: string) {
    setAnchorInfoLoading(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/wallets/${walletId}/balance-preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        setAnchorInfo({
          prevAmount: data.prevAmount,
          prevEffectiveDate: data.prevEffectiveDate,
          displayBalanceBefore: data.displayBalanceBefore,
        });
      }
    } finally {
      setAnchorInfoLoading(false);
    }
  }

  /**
   * 「下一步」——校验完新值之后，带着新锚点/新生效日再查一次同一个 balance-preview
   * 端点算出"改后系统算出的现余额"，查完才进入步骤③确认页。这一步本身不写库，
   * 真正落库要等确认页点"确认保存"（handleSetBalance）。
   */
  async function handleGoToConfirm(walletId: string) {
    setBalanceError(null);
    if (!balanceDate) {
      setBalanceError('请选择生效日期——这天之前的消费不会再扣，选错会影响历史计算。');
      return;
    }
    const amount = Number(balanceYuan);
    if (Number.isNaN(amount)) {
      setBalanceError('金额格式不对');
      return;
    }
    setConfirmLoading(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/wallets/${walletId}/balance-preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          newCurrentBalance: yuanToCents(amount),
          newBalanceUpdatedAt: new Date(balanceDate).toISOString(),
        }),
      });
      if (!res.ok) {
        setBalanceError('算不出改后余额，检查一下金额和日期');
        return;
      }
      const data = (await res.json()) as any;
      // 顺手把"改前"这份也用这次查到的刷新一遍——跟步骤①查到的理应一致（这中间
      // 没有别的写操作发生），但用同一次响应保证两个数字来自同一次查询，不会因为
      // 两次请求之间数据变了而错位。
      setAnchorInfo({
        prevAmount: data.prevAmount,
        prevEffectiveDate: data.prevEffectiveDate,
        displayBalanceBefore: data.displayBalanceBefore,
      });
      setConfirmPreview({ displayBalanceAfter: data.displayBalanceAfter });
      setBalanceStep('confirm');
    } finally {
      setConfirmLoading(false);
    }
  }

  async function handleSetBalance(walletId: string) {
    setBalanceError(null);
    if (!balanceDate) {
      setBalanceError('请选择生效日期');
      return;
    }
    const amount = Number(balanceYuan);
    if (Number.isNaN(amount)) {
      setBalanceError('金额格式不对');
      return;
    }
    setBalanceSubmitting(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/wallets/${walletId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          currentBalance: yuanToCents(amount),
          balanceUpdatedAt: new Date(balanceDate).toISOString(),
        }),
      });
      if (!res.ok) {
        setBalanceError('更新失败，检查一下金额');
        return;
      }
      setEditingWalletId(null);
      setBalanceStep('form');
      setAnchorInfo(null);
      setConfirmPreview(null);
      await loadWallets();
      // 这条钱包的历史面板如果之前打开过，缓存已经过期（多了一条新记录）——清掉
      // 强制下次展开重新查；如果面板现在正开着，立刻重新查一次让它马上看到新记录。
      setHistoryByWallet((prev) => {
        if (!(walletId in prev)) return prev;
        const next = { ...prev };
        delete next[walletId];
        return next;
      });
      if (historyOpenWalletId === walletId) await loadHistory(walletId);
    } finally {
      setBalanceSubmitting(false);
    }
  }

  async function loadHistory(walletId: string) {
    setHistoryLoadingId(walletId);
    try {
      const res = await fetch(`/api/trips/${tripId}/wallets/${walletId}/balance-history`);
      if (res.ok) {
        const data = (await res.json()) as any;
        setHistoryByWallet((prev) => ({ ...prev, [walletId]: data.history }));
      }
    } finally {
      setHistoryLoadingId(null);
    }
  }

  /** 只读历史面板的展开/收起（2026-09-26 新增）——点击本身不影响表单，不预填任何值。 */
  async function toggleHistory(walletId: string) {
    if (historyOpenWalletId === walletId) {
      setHistoryOpenWalletId(null);
      return;
    }
    setHistoryOpenWalletId(walletId);
    if (!historyByWallet[walletId]) {
      await loadHistory(walletId);
    }
  }

  /**
   * 「建钱包」按钮建完之后的回调（2026-09-24 第五十八轮，从这里抽到共享组件
   * `MissingWalletRow` 之前，原本这段逻辑连同请求本身都写在这个文件里；现在请求
   * 逻辑搬进了那个组件，这里只接住建好的钱包）——刷新钱包列表 + 直接把这个新钱包
   * 丢进 `startEditBalance`，呼应 Remy 要的"这一行就地变成可填余额的正常行"，
   * 不用她建完钱包还要再找一次「设置当前余额」按钮。
   */
  async function handleWalletCreated(w: CreatedWalletDto) {
    await loadWallets();
    startEditBalance(w);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.label.trim()) {
      setError('名称不能空着');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/payment-methods', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label: form.label.trim(),
          kind: form.kind,
          settlementCurrency: form.settlementCurrency,
          fxMarkupPercent: Number(form.fxMarkupPercent) || 0,
          foreignTxnFeePercent: Number(form.foreignTxnFeePercent) || 0,
          fixedFee: yuanToCents(Number(form.fixedFeeYuan) || 0),
          cashbackPercent: Number(form.cashbackPercent) || 0,
          // 带上 tripId：新建的这个支付方式对当前正看着的这趟行程默认启用，
          // 呼应 Artifact 截图里新建完直接是勾选态，不用建完还要再点一次勾选。
          tripId,
        }),
      });
      if (!res.ok) {
        setError('添加失败，检查一下表单内容');
        return;
      }
      setForm(emptyForm);
      await loadMethods();
    } finally {
      setSubmitting(false);
    }
  }

  async function performDelete(id: string) {
    setConfirmingId(null);
    await fetch(`/api/payment-methods/${id}`, { method: 'DELETE' });
    await loadMethods();
  }

  /** 点名字进入改名编辑态（round72b）。 */
  function startEditLabel(m: PaymentMethod) {
    setEditingLabelId(m.id);
    setLabelDraft(m.label);
    setLabelError(null);
  }

  function cancelEditLabel() {
    setEditingLabelId(null);
    setLabelError(null);
  }

  /**
   * 保存改名——后端 `PATCH /api/payment-methods/{id}` 早就支持 `label` 单字段更新
   * （`body.label ?? existing.label`），这里不用新开端点。空字符串在前端就拦（trim
   * 后长度要 >0），失败（网络错误/非 2xx）都要显示清楚的错误，不静默、不让编辑态
   * 卡死、也不让人以为"看起来已经改了"其实没成功——`labelDraft` 只有真的保存成功
   * 才清掉编辑态，失败时原样留在编辑态让人重试。
   *
   * 注：钱包卡片显示的名字是建钱包那一刻复制过去的独立字段（`wallet.label`），
   * 跟这里改的 `paymentMethod.label` 之后互不联动——这是已知的产品设计缺口，这次
   * 明确不处理（钱包名字要不要跟着改、还是钱包该转成读关联支付方式的名字，留给
   * Remy 下一轮拍板方向）。
   */
  async function handleSaveLabel(id: string) {
    const next = labelDraft.trim();
    if (!next) {
      setLabelError('名称不能空着');
      return;
    }
    setLabelError(null);
    setLabelSaving(true);
    try {
      const res = await fetch(`/api/payment-methods/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: next }),
      });
      if (!res.ok) {
        setLabelError('改名失败，检查一下网络再试一次');
        return;
      }
      setEditingLabelId(null);
      await loadMethods();
      router.refresh();
    } catch {
      setLabelError('改名失败，检查一下网络再试一次');
    } finally {
      setLabelSaving(false);
    }
  }

  /**
   * 「本行程启用的支付方式」勾选/取消勾选（2026-09-15 落地 Artifact Version 10
   * 遗留缺口）——乐观更新先翻转本地状态，请求失败再翻回去，跟这个文件里
   * `toggleConfirm`（settlement-body.tsx 那套模式）同样的做法。
   */
  async function handleToggleEnabled(m: PaymentMethod) {
    const nextEnabled = !m.enabled;
    setTogglingId(m.id);
    setMethods((prev) => prev?.map((x) => (x.id === m.id ? { ...x, enabled: nextEnabled } : x)) ?? prev);
    try {
      const res = await fetch(`/api/trips/${tripId}/payment-methods/${m.id}/enablement`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      if (!res.ok) {
        setMethods((prev) => prev?.map((x) => (x.id === m.id ? { ...x, enabled: m.enabled } : x)) ?? prev);
      }
    } finally {
      setTogglingId(null);
    }
  }

  // 「设置当前余额」面板延续上面「本行程启用的支付方式」同一套勾选（Artifact 第四轮
  // 拍板原话）：没绑支付方式的钱包（纯现金桶之类）一律照常显示，绑了支付方式的钱包
  // 只在那个支付方式这趟行程还勾着「启用」时才显示，取消勾选后从这个面板里收起来
  // （钱包本身、余额数据都没有被删，只是这个面板不再列出来）。
  // methods 还没载入完（null）时不做任何过滤，直接显示全部钱包——避免请求还没回来的
  // 一瞬间被误判成"全部支付方式都没启用"，出现一闪而过的假空状态。
  const enabledPaymentMethodIds = new Set((methods ?? []).filter((m) => m.enabled).map((m) => m.id));
  const visibleWallets =
    methods === null
      ? wallets ?? []
      : (wallets ?? []).filter((w) => !w.paymentMethodId || enabledPaymentMethodIds.has(w.paymentMethodId));

  // 「本行程已开启，但还没建对应钱包」的支付方式（2026-09-24 追加需求，实例：香港行程
  // 现金 USD 开了开关但从没建过钱包）——卡类要不要一并显示，查过 `wallet-grid.tsx` 的
  // `ICON_CHOICES`（🏦银行/💵现金/💳信用卡/📱手机支付 四个类型都能建钱包）+ 全项目
  // grep `currentBalance`/`emoji` 的每一处用法，钱包的余额加减、图标选择、DESIGN-BRIEF
  // 对"钱包"这个概念的定义（"每个参与者在每趟行程下自由建/命名多个钱包，各自绑定一个
  // 币种、有当前余额"）全部不区分卡/现金——没有任何代码或设计文档把"钱包"限定成只对应
  // 现金/储值类，信用卡走的不是另一套逻辑，是同一套。所以这里不按 `m.kind` 分卡/现金，
  // 两种都算。只在 `methods`/`wallets` 都真正载入完（都不是 null）才计算，避免请求还没
  // 回来的一瞬间把"还不知道"误判成"全部都没建钱包"。
  const walletsByPaymentMethodId = new Set(
    (wallets ?? []).map((w) => w.paymentMethodId).filter((id): id is string => id !== null)
  );
  const missingWalletMethods =
    methods === null || wallets === null ? [] : methods.filter((m) => m.enabled && !walletsByPaymentMethodId.has(m.id));

  return (
    // fix(2026-09-16 第十七轮)：gap-8(32px) 收到 gap-2.5(10px)，理由同 invites-manager.tsx。
    <div className="flex flex-col gap-2.5">
      <section className="flex flex-col gap-2">
        {/* fix(2026-09-16 第十八轮)：小标题统一成 Artifact `section.blk h4` 规格。
            fix(2026-09-18 第二十五轮)：读 Artifact 源码发现支付方式屏有专属 scoped
            override `#scr-payment section.blk h4{font-size:9px}`（比通用的 10px
            再收一档），round18 当时只套用了通用 10px 版本，没查到这条页面专属覆盖，
            这次三处小标题全部改成字面一致的 9px。 */}
        <h2 className="text-[9px] font-medium tracking-[0.08em] text-neutral-dk">已配置的支付方式</h2>
        {methods === null ? (
          <p className="text-xs text-muted">载入中…</p>
        ) : methods.length === 0 ? (
          <p className="text-xs text-muted">还没配置任何支付方式。</p>
        ) : (
          // fix(2026-09-17 第二十一轮，独立 ui-auditor 盲测坐实：这个列表跟结算屏
          // 用的不是同一套 token)：Artifact 这里也是共用的 `.list` 容器（圆角14px/
          // gap 2px，`#scr-payment .list{padding:3px 5px}`）包着多个 `.p-row`
          // （`#scr-payment .p-row{padding:3px 0;gap:5px}`），不是"每一行各自一个
          // 独立描边卡片"（之前用的 `tx-item` chokepoint 是圆角12px/自带padding/
          // 行与行之间用 gap-2(8px) 分开，两套完全不同的视觉语言）。改成跟
          // settlement-body.tsx 净值/转账清单同一套写法。
          <ul className="flex flex-col gap-[2px] rounded-[14px] border border-sand bg-[rgba(164,163,160,.14)] px-[5px] py-[3px] shadow-card">
            {methods.map((m) => (
              <li key={m.id} className="flex items-center gap-[5px] py-[3px]">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-circle text-sm"
                  aria-hidden="true"
                >
                  {m.kind === 'card' ? '💳' : '💵'}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  {/* fix(round72b)："点名字进入编辑态"改名交互——原来 `m.label` 是纯文字，
                      没有任何点击/编辑入口。改名跟点上面 my-trips.tsx `TripCard` 那处
                      改行程名字同一套模式（field-input + 保存/取消），差别是这里不用
                      绝对定位覆盖卡片（这一行本身不是可点开的大按钮，不会跟别的点击区
                      抢事件），编辑态直接原地展开在这两行文字的位置。 */}
                  {editingLabelId === m.id ? (
                    <div className="flex flex-col gap-1.5 py-0.5">
                      <input
                        autoFocus
                        value={labelDraft}
                        onChange={(e) => setLabelDraft(e.target.value)}
                        disabled={labelSaving}
                        placeholder="支付方式名称"
                        aria-label="支付方式名称"
                        className="field-input"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={labelSaving}
                          onClick={() => handleSaveLabel(m.id)}
                          className="btn-secondary"
                        >
                          {labelSaving ? '保存中…' : '保存'}
                        </button>
                        <button
                          type="button"
                          disabled={labelSaving}
                          onClick={cancelEditLabel}
                          className="tap-link text-[11px] text-muted"
                        >
                          取消
                        </button>
                      </div>
                      {labelError && <p className="text-[10px] text-coral">{labelError}</p>}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEditLabel(m)}
                      aria-label={`编辑支付方式名称「${m.label}」`}
                      className="flex items-center gap-1 self-start text-left text-[10px] font-medium hover:text-ink"
                    >
                      {/* Artifact `#scr-payment .nm{font-size:10px}` */}
                      <span>
                        {m.label}（{m.kind === 'card' ? '卡' : '现金'} · {m.settlementCurrency}）
                      </span>
                      <span aria-hidden="true" className="text-muted">
                        ✎
                      </span>
                    </button>
                  )}
                  {/* Artifact `#scr-payment .tag-note{font-size:8.5px}`——之前是10px。 */}
                  <span className="mt-0.5 border-t border-dashed border-sand pt-1 text-[8.5px] text-muted">
                    汇率加点 {m.fxMarkupPercent}% · 境外手续费 {m.foreignTxnFeePercent}% · 返现 {m.cashbackPercent}%
                    {m.fixedFee > 0 && (
                      <>
                        {' · 固定费 '}
                        <span className="font-serif tabular-nums">
                          {formatMoney(m.fixedFee, m.settlementCurrency)}
                        </span>
                      </>
                    )}
                  </span>
                </div>
                {/* Artifact `#scr-payment .del-icon{font-size:10px;padding:2px}`——
                    之前是 text-[11px]/p-[3px]。 */}
                <button
                  type="button"
                  onClick={() => setConfirmingId(m.id)}
                  aria-label={`删除支付方式「${m.label}」`}
                  className="shrink-0 p-[2px] text-[10px] text-coral"
                >
                  🗑
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 「本行程启用的支付方式」（2026-09-15 落地 Artifact Version 10 遗留缺口）：
          payment_method 是账号/participant 级数据，跨行程复用，这里勾/不勾只影响
          这一趟行程——「记一笔消费」的支付方式下拉、下面「设置当前余额」面板都只看
          这个勾选结果，不看「已配置的支付方式」那份账号级全量列表。行存在于
          trip_payment_method_enabled 即勾选，删行即取消勾选（PUT enablement 端点）。 */}
      <section className="flex flex-col gap-2">
        <h2 className="text-[9px] font-medium tracking-[0.08em] text-neutral-dk">本行程启用的支付方式</h2>
        <p className="text-[10px] text-muted">这行程要用到哪几张卡/钱包，不用的可以取消勾选，记账时下拉选单会更短。</p>
        {methods === null ? (
          <p className="text-xs text-muted">载入中…</p>
        ) : methods.length === 0 ? (
          <p className="text-xs text-muted">还没配置任何支付方式，先在下面新增一个。</p>
        ) : (
          // fix(2026-09-17 第二十一轮)：同上——这里也改成共用 `.list` 容器包
          // `.check-row`（`font-size:10.5px`），不再是每行各自一个独立描边胶囊。
          <ul className="flex flex-col gap-[2px] rounded-[14px] border border-sand bg-[rgba(164,163,160,.14)] px-[5px] py-[3px] shadow-card">
            {methods.map((m) => (
              <li key={m.id} className="flex items-center gap-[5px] py-[3px]">
                {/* fix(2026-09-24 第三十九轮，团队看板 id=2026-09-23_232946_2850b4c5)：
                    之前是浏览器原生 `<input type="checkbox">`（默认蓝色），跟这个项目
                    唯一一套自定义深色开关（原本只有 expense-form.tsx"跟其他人 split
                    这笔"那处，这轮抽成了 `components/switch.tsx` 共用组件）不搭。
                    `<button>` 本身是 HTML labelable element，`id` 传给它、下面
                    `<label htmlFor>` 照常指向、点文字一样能触发，不用额外接
                    aria-labelledby（跟 select-dropdown.tsx 里同样的做法）。 */}
                <Switch
                  id={`pm-enabled-${m.id}`}
                  checked={m.enabled}
                  disabled={togglingId === m.id}
                  onChange={() => handleToggleEnabled(m)}
                  ariaLabel={`本行程启用「${m.label}」`}
                />
                <label htmlFor={`pm-enabled-${m.id}`} className="flex-1 text-[10.5px]">
                  {m.label}（{m.kind === 'card' ? '卡' : '现金'} · {m.settlementCurrency}）
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[9px] font-medium tracking-[0.08em] text-neutral-dk">新增支付方式</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="field-label" htmlFor="pm-label">
                名称
              </label>
              <input
                id="pm-label"
                required
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="例如：HSBC 万事达卡"
                className="field-input"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="field-label" htmlFor="pm-kind">
                类型
              </label>
              <SelectDropdown
                id="pm-kind"
                value={form.kind}
                onChange={(next) => setForm((f) => ({ ...f, kind: next as 'card' | 'cash' }))}
                triggerClassName="field-input w-full"
                options={[
                  { value: 'card', label: '卡' },
                  { value: 'cash', label: '现金' },
                ]}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="field-label" htmlFor="pm-currency">
              结算币种
            </label>
            <SelectDropdown
              id="pm-currency"
              value={form.settlementCurrency}
              onChange={(next) => setForm((f) => ({ ...f, settlementCurrency: next }))}
              triggerClassName="field-input w-full"
              options={PAYMENT_METHOD_SETTLEMENT_CURRENCIES.map((c) => ({ value: c, label: c }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="field-label" htmlFor="pm-fx-markup">
                汇率加点 %
              </label>
              <input
                id="pm-fx-markup"
                type="number"
                step="0.01"
                min="0"
                value={form.fxMarkupPercent}
                onChange={(e) => setForm((f) => ({ ...f, fxMarkupPercent: e.target.value }))}
                className="field-input"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="field-label" htmlFor="pm-foreign-fee">
                境外手续费 %
              </label>
              <input
                id="pm-foreign-fee"
                type="number"
                step="0.01"
                min="0"
                value={form.foreignTxnFeePercent}
                onChange={(e) => setForm((f) => ({ ...f, foreignTxnFeePercent: e.target.value }))}
                className="field-input"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="field-label" htmlFor="pm-fixed-fee">
                固定费（结算币种，元）
              </label>
              <input
                id="pm-fixed-fee"
                ref={fixedFeeInputRef}
                type="text"
                inputMode="decimal"
                value={formatThousands(form.fixedFeeYuan)}
                onChange={(e) => {
                  const rawInput = e.target.value;
                  const selectionStart = e.target.selectionStart ?? rawInput.length;
                  const meaningfulBefore = countMeaningfulCharsBefore(rawInput, selectionStart);
                  const candidate = stripThousands(rawInput);
                  if (!/^\d*\.?\d*$/.test(candidate)) return;
                  pendingFixedFeeCursorRef.current = meaningfulBefore;
                  setForm((f) => ({ ...f, fixedFeeYuan: candidate }));
                }}
                className="field-input font-serif tabular-nums"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="field-label" htmlFor="pm-cashback">
                返现 %
              </label>
              <input
                id="pm-cashback"
                type="number"
                step="0.01"
                min="0"
                value={form.cashbackPercent}
                onChange={(e) => setForm((f) => ({ ...f, cashbackPercent: e.target.value }))}
                className="field-input"
              />
            </div>
          </div>

          {error && <p className="text-sm text-coral">{error}</p>}

          {/* fix(2026-09-17 第十九轮)：Artifact 这一屏的主按钮是 `.big-cta`（跟表单等宽），
              之前用 .btn-primary 紧凑胶囊，是全站同一批"表单主按钮误用紧凑 class"问题
              的其中一处。 */}
          <button
            type="submit"
            disabled={submitting}
            className="big-cta"
          >
            {submitting ? '添加中…' : '添加支付方式'}
          </button>
        </form>
      </section>

      {/* fix(2026-09-14 Artifact Version 10 走查补做)："设置当前余额"之前常驻在页面最上面
          一整块，Artifact 里这是页面底部一颗按钮，点开才展开钱包余额清单。这里改成同样
          的收合形态，位置也挪到最下面——这一步操作的其实是 trip-level 的 wallets（这趟
          行程里具体每张卡/现金的余额），不是上面账号级 paymentMethods（那份只存费率配置，
          没有余额字段），Artifact 把它画在"支付方式"页只是信息架构上的归类，底层数据没变。 */}
      <section id="set-balance" className="flex flex-col gap-2">
        {/* fix(2026-09-17 第十九轮)：曾经改成 .big-cta 全宽（历史：第十九轮之前是"小胶囊+
            取消文字链接"，被判定跟方案不符改回全宽；第一轮紧凑化又补了 Artifact scoped 的
            更小 padding/字号 `#scr-payment .big-cta{padding:6px; font-size:10.5px}`）。
            fix(2026-09-24，紧凑化第二轮，Remy 看过紧凑化第一轮截图后明确拍板)：全宽双色 CTA
            这个形状字面上确实是 Artifact V10 原意（`reference/artifact-v10-source.html:931`
            `<button class="big-cta" style="background:var(--neutral-dk)">`），第一轮结尾也
            如实标注过"如果 Remy 看过这版还是觉得该收成非全宽小按钮，是一次新的方案偏离判断，
            留给她确认"——现在她确认了：这颗按钮跟上面"添加支付方式"黑色主按钮放在一起，即使
            换了颜色也还是同等视觉分量的整行 CTA，主次不够分明，要求改成真正的次级小按钮，不占
            满整行。这是 Remy 本人看真实截图后的新判断，不是这次自己推翻方案，如实记录成
            "这颗按钮不再跟表单主按钮走同一套 CTA 组件，改用这个 app 已有的次级按钮
            chokepoint"。挑了 `.btn-secondary`（`app/globals.css`，白底描边 + `min-h-[32px]`
            触控热区，DESIGN-BRIEF 里明确定义给"不需要抢主按钮风头的动作"用）而不是这份文件
            自己那处深色 `mini-btn` 风格写法（钱包行"设置"按钮那颗 bg-ink 小胶囊）——因为
            mini-btn 那套是行内列表里的次要动作，视觉上仍是深色实心，跟主按钮的"黑"还是同一
            色系分量；而这颗按钮是整节的独立触发器，要的是"一眼看出比上面主按钮轻"，
            `.btn-secondary` 的白底描边在色重上跟黑色主按钮拉开明显差距，语义（"次要操作
            按钮"）和视觉分量都更吻合。`self-start` 是这个 app 既有的同款写法（对照
            `app/account/hard-refresh-button.tsx` "强制刷新最新版本"那颗按钮，同样是
            `flex flex-col` 容器里的孤零按钮）——不加会被 flex-col 默认的 `align-items:
            stretch` 撑成全宽，白白抵消掉换 class 的效果。字号 Remy 说了不用再调，保持这次
            紧凑化之前就有的 10.5px（跟 `.btn-secondary` 自带的 11px 有 0.5px 差异，显式覆盖
            保留原值，不跟着 class 默认值走）。图标 ⚙ 沿用不变。 */}
        <button
          type="button"
          onClick={() => setBalancePanelOpen((v) => !v)}
          className="btn-secondary self-start text-[10.5px]"
        >
          ⚙ 设置当前余额
        </button>
        {balancePanelOpen && (
          <div className="flex flex-col gap-2">
            {/* fix(2026-09-24 第三十九轮，团队看板"历史现金消费回溯补算进钱包余额")：round38
                这句话说"已经记过的消费不会补算"，那时候是真的。这轮实现了创建钱包时的一次性
                历史回溯（同支付方式+同币种，建钱包那一刻之前记过的消费会一次性补进起始余额），
                这句话改成讲实际行为，同时如实标出没覆盖的边界——不是所有历史消费都保证会被
                补算，取决于钱包创建时有没有直接绑支付方式。
                fix(2026-09-24，紧凑化第一轮)：原三句话压成一句，字号跟页面其它小字（tag-note/
                del-icon 那档）对齐到 8.5px（原本是 10px，单独冒出一档偏大）。两个必须保留的
                事实——①这里改的是钱包余额，跟上面账号级支付方式费率配置是两码事 ②绑定前的
                历史消费会补进来——都还在，只是"钱包建好后才补绑不会自动补"这个次要边界情况
                挪进后半句括号里，不占独立句子。 */}
            <p className="text-[8.5px] text-muted">
              这里改的是钱包余额，跟上面支付方式的费率配置是两码事；建钱包时如果直接绑了支付方式，之前的同类消费会自动补进来（钱包建好后才补绑的话不会，需要自己对一次）。
            </p>
            {wallets === null ? (
              <p className="text-xs text-muted">载入中…</p>
            ) : /* fix(2026-09-24 追加需求)：原本 `wallets.length === 0` 就直接把人指去行程
                  主页新建——但如果这趟行程已经开启了某些支付方式、只是还没建对应钱包，
                  下面的 `missingWalletMethods` 列表本身就能就地建，不用再往别的页面绕。
                  两条空状态文案都加上 `missingWalletMethods.length === 0` 这个条件，
                  只有"连一个可建的支付方式都没有"才继续显示旧文案。 */
            wallets.length === 0 && missingWalletMethods.length === 0 ? (
              <p className="text-xs text-muted">还没建过钱包，先去行程主页新建。</p>
            ) : visibleWallets.length === 0 && missingWalletMethods.length === 0 ? (
              <p className="text-xs text-muted">
                这趟行程建过的钱包都绑着已取消勾选的支付方式，去上面「本行程启用的支付方式」重新勾选看看。
              </p>
            ) : (
              /* fix(2026-09-24，紧凑化第一轮)：原本每个钱包各自一张 `tx-item` 卡片、占两行
                 （名称+按钮一行，金额+日期一行），跟上面"已配置的支付方式"/"本行程启用的
                 支付方式"两个区块（round21 已经改成共用 `.list` 容器 + 一行一条）不是同一套
                 视觉语言，是这个文件里唯一还没跟上的一处，也是 Remy 这次截图点名的地方。
                 改成同一个 `.list` 容器，每个钱包尽量一行：图标+名称+币种 / 金额 / 最近记录
                 日期 / 小号按钮。按钮不再用 `.btn-secondary`（HIG 32px 触控热区，两行卡片里
                 撑成一颗大白胶囊是主因之一），改用 Artifact 同一屏定义过的 `.mini-btn`
                 视觉（深色小胶囊，bg-ink/text-[9px]/padding 3px 8px，见
                 reference/artifact-v10-source.html:345 `.mini-btn` + :388 scoped
                 `#scr-payment .mini-btn{font-size:9px;padding:3px 8px}`）——这个 class
                 本身还没被搬进 globals.css 做成站内共用 chokepoint（现在只有这一屏两处用到，
                 没有到需要建新全局 class 的规模），这里先按 Artifact 数值内联，不建新
                 chokepoint，避免在没有把关全站其它位置的情况下贸然扩大一个新按钮规格的
                 影响面。编辑态展开的输入框仍是主动操作时才出现，不是常态，沿用原本
                 `field-input`/`btn-secondary`/`tap-link` 没有改。 */
              <ul className="flex flex-col rounded-[14px] border border-sand bg-[rgba(164,163,160,.14)] px-[5px] py-[3px] shadow-card">
                {visibleWallets.map((w) => (
                  <li key={w.id} className="flex flex-col gap-1 border-b border-sand py-[4px] last:border-b-0">
                    <div className="flex items-center gap-[5px]">
                      <span aria-hidden="true" className="shrink-0">
                        {w.emoji}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[10px] font-medium">
                        {w.label} <span className="font-mono text-[8.5px] text-muted">{w.currency}</span>
                      </span>
                      <span className="shrink-0 font-serif text-[10.5px] tabular-nums">
                        {formatMoney(w.currentBalance, w.currency)}
                      </span>
                      {w.balanceUpdatedAt && (
                        <span className="shrink-0 text-[8px] text-muted">
                          {new Date(w.balanceUpdatedAt).toLocaleDateString()}
                        </span>
                      )}
                      {/* fix(2026-09-26，历史记录只读展示)：跟"设置"同一排的小号文字按钮，
                          点击只展开/收起下面的只读历史面板，不影响上面的"设置当前余额"表单——
                          两者是完全独立的两件事，可以同时开着。 */}
                      <button
                        type="button"
                        onClick={() => toggleHistory(w.id)}
                        aria-expanded={historyOpenWalletId === w.id}
                        className="shrink-0 text-[9px] text-muted underline underline-offset-2"
                      >
                        历史{historyOpenWalletId === w.id ? ' ▲' : ' ▾'}
                      </button>
                      {editingWalletId !== w.id && (
                        <button
                          type="button"
                          onClick={() => startEditBalance(w)}
                          className="shrink-0 rounded-full bg-ink px-[8px] py-[3px] text-[9px] font-medium text-white transition-colors hover:bg-accent-800"
                        >
                          设置
                        </button>
                      )}
                    </div>

                    {/* 防覆盖确认流程步骤①②合并同一屏（2026-09-26 新增）：先看当前锚点+
                        系统算出的现余额，再往下填新值——字号/间距套用这个 app 已有的
                        field-label(9px)/field-input(10px) 阶梯，金额展示统一 font-serif
                        text-[10.5px]（跟这一屏其它金额同一档，不再冒出一个独立的大号衬线
                        字体跟旁边小字说明反差过大）。 */}
                    {editingWalletId === w.id && balanceStep === 'form' && (
                      <div className="flex flex-col gap-2 rounded-xl border border-sand bg-white p-2">
                        {anchorInfoLoading || !anchorInfo ? (
                          <p className="text-[9px] text-muted">载入当前锚点中…</p>
                        ) : (
                          <div className="flex flex-col gap-1 rounded-lg bg-[rgba(164,163,160,.14)] px-2 py-1.5">
                            <p className="text-[9px] text-muted">
                              当前锚点：
                              {anchorInfo.prevAmount !== null && anchorInfo.prevEffectiveDate ? (
                                <span className="font-serif text-[10.5px] tabular-nums text-ink">
                                  {' '}
                                  {formatMoney(anchorInfo.prevAmount, w.currency)} ·{' '}
                                  {new Date(anchorInfo.prevEffectiveDate).toLocaleDateString()}
                                </span>
                              ) : (
                                <span className="text-ink"> 还没设置过</span>
                              )}
                            </p>
                            <p className="text-[9px] text-muted">
                              系统算出的现余额：
                              <span className="font-serif text-[10.5px] tabular-nums text-ink">
                                {' '}
                                {formatMoney(anchorInfo.displayBalanceBefore, w.currency)}
                              </span>
                            </p>
                          </div>
                        )}

                        <div className="flex flex-wrap items-end gap-2">
                          <div className="flex flex-col gap-1">
                            <label className="field-label" htmlFor={`wallet-balance-${w.id}`}>
                              新余额（{w.currency}）
                            </label>
                            <input
                              id={`wallet-balance-${w.id}`}
                              ref={balanceInputRef}
                              type="text"
                              inputMode="decimal"
                              value={formatThousands(balanceYuan)}
                              onChange={(e) => {
                                const rawInput = e.target.value;
                                const selectionStart = e.target.selectionStart ?? rawInput.length;
                                const meaningfulBefore = countMeaningfulCharsBefore(rawInput, selectionStart);
                                const candidate = stripThousands(rawInput);
                                if (!/^\d*\.?\d*$/.test(candidate)) return;
                                pendingBalanceCursorRef.current = meaningfulBefore;
                                setBalanceYuan(candidate);
                              }}
                              className="field-input w-28 font-serif tabular-nums"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="field-label" htmlFor={`wallet-balance-date-${w.id}`}>
                              生效日期
                            </label>
                            {/* fix(2026-09-26，防覆盖确认流程)：故意不给 value 塞今天当默认值
                                （下面 startEditBalance 已经把 balanceDate 初始成空字符串）——
                                逼着用户自己主动选一天，不能什么都不选就直接点"下一步"。 */}
                            <input
                              id={`wallet-balance-date-${w.id}`}
                              type="date"
                              value={balanceDate}
                              onChange={(e) => setBalanceDate(e.target.value)}
                              className="field-input"
                            />
                          </div>
                        </div>
                        <p className="text-[8.5px] text-muted">这天之前的消费不会再扣，选错会影响历史计算。</p>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={confirmLoading}
                            onClick={() => handleGoToConfirm(w.id)}
                            className="btn-secondary"
                          >
                            {confirmLoading ? '算中…' : '下一步'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingWalletId(null)}
                            className="tap-link text-[11px] text-muted"
                          >
                            取消
                          </button>
                        </div>
                        {balanceError && <p className="text-[10px] text-coral">{balanceError}</p>}
                      </div>
                    )}

                    {/* 步骤③保存前确认页：改前锚点/现余额用删除线，改后正常显示——真正提交
                        PATCH 要等这一步点"确认保存"，前面两步都只是查预览、没有写库。 */}
                    {editingWalletId === w.id && balanceStep === 'confirm' && anchorInfo && confirmPreview && (
                      <div className="flex flex-col gap-2 rounded-xl border border-sand bg-white p-2">
                        <p className="text-[9px] text-muted">保存后会追加一条历史记录，确认没错再保存。</p>
                        <div className="flex flex-col gap-1 rounded-lg bg-[rgba(164,163,160,.14)] px-2 py-1.5">
                          <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[9px] text-muted">
                            <span>锚点：</span>
                            {anchorInfo.prevAmount !== null && anchorInfo.prevEffectiveDate ? (
                              <span className="font-serif text-[10.5px] tabular-nums text-muted line-through">
                                {formatMoney(anchorInfo.prevAmount, w.currency)} ·{' '}
                                {new Date(anchorInfo.prevEffectiveDate).toLocaleDateString()}
                              </span>
                            ) : (
                              <span className="text-muted line-through">从未设置</span>
                            )}
                            <span>→</span>
                            <span className="font-serif text-[10.5px] tabular-nums text-ink">
                              {formatMoney(yuanToCents(Number(balanceYuan) || 0), w.currency)} ·{' '}
                              {balanceDate ? new Date(balanceDate).toLocaleDateString() : ''}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[9px] text-muted">
                            <span>现余额：</span>
                            <span className="font-serif text-[10.5px] tabular-nums text-muted line-through">
                              {formatMoney(anchorInfo.displayBalanceBefore, w.currency)}
                            </span>
                            <span>→</span>
                            <span className="font-serif text-[10.5px] tabular-nums text-ink">
                              {formatMoney(confirmPreview.displayBalanceAfter, w.currency)}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={balanceSubmitting}
                            onClick={() => handleSetBalance(w.id)}
                            className="btn-secondary"
                          >
                            {balanceSubmitting ? '保存中…' : '确认保存'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setBalanceStep('form')}
                            className="tap-link text-[11px] text-muted"
                          >
                            上一步
                          </button>
                        </div>
                        {balanceError && <p className="text-[10px] text-coral">{balanceError}</p>}
                      </div>
                    )}

                    {/* 历史记录只读展示（2026-09-26 新增）——每条只显示三块信息：这次设置
                        的锚点值@生效日／改动日期＋现余额改前→改后，不显示"由谁设置"这种
                        操作者文字（Remy 明确要求去掉），点击条目本身不做任何事，没有"恢复
                        这版"/"带回表单预填"这两个交互，设计稿还没定，这轮只做只读展示。 */}
                    {historyOpenWalletId === w.id && (
                      <div className="flex flex-col gap-1.5 rounded-xl border border-sand bg-white p-2">
                        {historyLoadingId === w.id ? (
                          <p className="text-[9px] text-muted">载入历史中…</p>
                        ) : !historyByWallet[w.id] ? (
                          <p className="text-[9px] text-muted">还没有历史记录。</p>
                        ) : historyByWallet[w.id]!.length === 0 ? (
                          <p className="text-[9px] text-muted">还没设置过当前余额，没有历史记录。</p>
                        ) : (
                          <ul className="flex flex-col gap-1.5">
                            {historyByWallet[w.id]!.map((h) => (
                              <li
                                key={h.id}
                                className="flex flex-col gap-0.5 border-b border-dashed border-sand pb-1.5 last:border-b-0 last:pb-0"
                              >
                                <span className="font-serif text-[10.5px] tabular-nums text-ink">
                                  {formatMoney(h.amount, w.currency)} · {new Date(h.effectiveDate).toLocaleDateString()}
                                </span>
                                <span className="text-[9px] text-muted">
                                  {new Date(h.changedAt).toLocaleDateString()} ·{' '}
                                  <span className="font-serif tabular-nums">
                                    {formatMoney(h.displayBalanceBefore, w.currency)}
                                  </span>
                                  {' → '}
                                  <span className="font-serif tabular-nums">
                                    {formatMoney(h.displayBalanceAfter, w.currency)}
                                  </span>
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                ))}
                {/* fix(2026-09-24 第五十八轮)：这一行的判断逻辑 + 建钱包交互整段抽到
                    共享组件 `MissingWalletRow`（'list-row' 变体，视觉/行为跟改之前
                    完全一致）——行程主页「我的钱包」区块现在也要出现同一套判断，抽出来
                    避免两处各自维护一份、以后漂移。 */}
                {missingWalletMethods.map((m) => (
                  <MissingWalletRow
                    key={`missing-wallet-${m.id}`}
                    tripId={tripId}
                    method={m}
                    variant="list-row"
                    onCreated={handleWalletCreated}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirmingId !== null}
        message="确定要删除这个支付方式吗？"
        confirmLabel="删除"
        onConfirm={() => confirmingId && performDelete(confirmingId)}
        onCancel={() => setConfirmingId(null)}
      />
    </div>
  );
}
