'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { COMMON_CURRENCIES } from '@/lib/currencies';
import { formatMoney } from '@/lib/money';
import { SelectDropdown } from '@/components/select-dropdown';
import { ConfirmDialog } from '@/components/confirm-dialog';

export interface WalletItem {
  id: string;
  label: string;
  currency: string;
  emoji: string;
  currentBalance: number;
  paymentMethodId: string | null;
  linkedPaymentMethodLabel: string | null;
}

export interface WalletPaymentMethodOption {
  id: string;
  label: string;
  settlementCurrency: string;
}

// fix(2026-09-12 走查)：原本是纯 emoji 按钮，选了哪个类型全靠猜。改成 {emoji, label}
// 数组，配合下面「已选：xx」常显小字 + 每颗按钮的 title 悬浮提示，两条腿一起解决
// 「看不懂选的是什么」——常显文字满足手机触屏（没有 hover），title 顺手满足桌面。
// 没在按钮旁边逐个摆文字标签：7 个类型都要摆的话（"银行卡"/"网络钱包"这种 2-4 字）
// 横向空间不够摆一整排还不换行，压缩比 compact 目标更糟。
//
// fix(2026-09-13 Artifact Version 10 落地，开放问题③，未真正拍板)：新建钱包这一步
// 能选的图标从 7 个精简到 4 个（🏦银行/💵现金/💳信用卡/📱手机支付）。保守处理：
// 只收窄这份"新建时能选"的列表，历史钱包如果用了 🌐/🟠/💰ing 这几个被砍掉的图标，
// 渲染逻辑本来就是直接读 w.emoji 字段、不反查这张表，不受影响，不用做任何数据迁移。
const ICON_CHOICES = [
  { emoji: '🏦', label: '银行' },
  { emoji: '💵', label: '现金' },
  { emoji: '💳', label: '信用卡' },
  { emoji: '📱', label: '手机支付' },
] as const;
const NO_LINK = '__none__';

/**
 * 横向可滚动一行（不是网格换行）：钱包数量因人而异，数量一多网格会挤爆版面，
 * 横向滚动能优雅容纳任意数量（DESIGN-BRIEF.md 第三版「逐区块改动点」第一小节）。
 */
export function WalletGrid({
  tripId,
  wallets,
  paymentMethods,
  variant = 'default',
  defaultCurrency,
}: {
  tripId: string;
  wallets: WalletItem[];
  paymentMethods: WalletPaymentMethodOption[];
  // 'embedded-dark'：塞进方案C 合并卡（深色渐变底）时用，只换钱包胶囊本身的配色
  // （套 DESIGN-BRIEF-hero-wallet-variants.html .wallet-c-chip 规格），不影响「新建钱包」
  // 表单——那段设计稿完全没提规格，继续用现有浅色表单样式渲染在深色卡外面。
  variant?: 'default' | 'embedded-dark';
  // fix(2026-09-17 第十九轮)：新建钱包默认币种之前写死 COMMON_CURRENCIES[0]（MYR），
  // 跟这趟行程本位币（比如香港行程的 HKD）不一致时，"绑定支付方式"下拉会因为
  // eligibleMethods（按币种精确匹配）算出空列表而完全不显示——独立 ui-auditor 盲测
  // 就是在这个默认状态下看到"完全没有这个字段"，不是真的没做，是默认值选错了币种。
  // 传行程本位币做默认值，覆盖最常见的"新建一个本位币钱包"场景。
  defaultCurrency?: string;
}) {
  const isDark = variant === 'embedded-dark';
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [currency, setCurrency] = useState<string>(defaultCurrency ?? COMMON_CURRENCIES[0]);
  const [emoji, setEmoji] = useState<string>(ICON_CHOICES[0].emoji);
  const [paymentMethodId, setPaymentMethodId] = useState(NO_LINK);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 删钱包（2026-09-18，第二十三轮补的真实缺口）：后端 DELETE 端点其实一直都有
  // （round22 查证过），只是前端从没接过按钮。确认弹层的文案是动态的——有余额/
  // 有关联换汇记录两种情况都要在点"删除"之前把后果说清楚，不是无差别一句
  // "确定删除吗"，防的是误删掉还有钱在里面的钱包。
  const [confirmingWallet, setConfirmingWallet] = useState<WalletItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const selectedIconLabel = ICON_CHOICES.find((c) => c.emoji === emoji)?.label ?? '';

  async function performDeleteWallet() {
    if (!confirmingWallet) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/wallets/${confirmingWallet.id}`, { method: 'DELETE' });
      if (res.status === 409) {
        // 后端这个 409 语义是"这个钱包有关联的换汇记录，删了会留下指向不存在钱包
        // 的历史记录，拒绝执行"（见 wallets/[walletId]/route.ts DELETE 注释）——
        // 不是把这情况当成普通失败吞掉，明确告诉 Remy 该去哪里先处理。
        setDeleteError(`「${confirmingWallet.label}」有关联的换汇记录，没法直接删——先去下面「换汇」列表删掉相关记录，再回来删这个钱包。`);
        setConfirmingWallet(null);
        return;
      }
      if (!res.ok) {
        setDeleteError('删除失败，请稍后再试。');
        setConfirmingWallet(null);
        return;
      }
      setConfirmingWallet(null);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  // fix(2026-09-17 第十九轮，独立 ui-auditor 第二轮盲测发现的小问题)：这个弹层
  // modal 只能点右上角 ✕ 关闭，按 Esc 没反应——大部分弹层的通用习惯是 Esc 也能关，
  // 补上。只在 isDark（真正是 modal 的那个变体）+ creating（弹层真的开着）时监听。
  useEffect(() => {
    if (!(isDark && creating)) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setCreating(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDark, creating]);

  // 只有跟当前选的钱包币种完全一致的支付方式才有意义绑——扣款逻辑要求币种精确匹配，
  // 列出币种不一致的选项只会让人绑了也白绑（app/api/trips/[tripId]/expenses/route.ts）。
  const eligibleMethods = paymentMethods.filter((m) => m.settlementCurrency === currency);

  // fix(2026-09-16 第十七轮，Remy 真实截图坐实的真 bug + 核实 Artifact 设计意图)：
  // 之前 embedded-dark 模式把表单 portal 到 page.tsx 里 `#wallet-form-slot` 这个插槽，
  // 但那个插槽在 DOM 里排在 WalletCard 整个 Fragment（钱包卡 + 快速记账卡两个 section）
  // 之后——WalletCard 把这两张卡包在同一个 Fragment 里返回，所以插槽实际位置落在
  // "快速记账"卡下面，不是"我的钱包"卡下面，这是 Remy 截图里表单跑错地方的直接原因。
  // 重新核对了 Artifact 侧栏这屏的标题——"新建钱包（弹层）"，唯一带"（弹层）"后缀的
  // 一屏（其它记账/结算/邀请管理这些都是纯屏名，没有这个后缀），说明设计意图就是
  // 一个浮层/弹窗，不是"挪个位置继续内联撑开页面"。这次直接做成真正的 modal（用
  // components/confirm-dialog.tsx 同一套 `fixed inset-0 + bg-ink/40` 语言，不新发明一套），
  // 用 React Portal 挂到 document.body，不再依赖 page.tsx 里那个位置写死的插槽 div，
  // 也就顺带删掉了 page.tsx 那个 `#wallet-form-slot`。

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) {
      setError('钱包名不能空着');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/wallets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label: label.trim(),
          currency,
          emoji,
          // fix(2026-09-13 Artifact Version 10 落地)：起始余额字段整个拿掉了（第四轮
          // 拍板"余额改由支付方式页的『设置当前余额』统一承担"），新钱包一律从 0 起步，
          // initialBalance 字段本身在 API/schema 层继续保留（可选，默认 0），只是这个
          // 表单不再主动填它。
          paymentMethodId: paymentMethodId === NO_LINK ? undefined : paymentMethodId,
        }),
      });
      if (!res.ok) {
        setError('新建失败，检查一下表单内容');
        return;
      }
      setLabel('');
      setPaymentMethodId(NO_LINK);
      setCreating(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  // fix(2026-09-12 走查)：compact 化对齐 expense-form.tsx 的记账表单——字段一律
  // field-label(10px)+field-input(12.5px/px-[9px] py-2/rounded-xl) 这套已定案的
  // token，不新造尺寸；每个字段都带常显标签（原本纯靠 placeholder，输入后标签就
  // 消失，看不出这格是什么）。账户类型图标原本跟起始余额挤同一个 grid-cols-2 半栏
  // （只有约 155px 宽却要塞 7 颗 28px 圆钮），flex 没设 shrink-0 导致被压扁成
  // 20×28 的椭圆；这次让图标行独占一整行宽度，够摆下 7 颗不用挤。
  const formFields = (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="field-label" htmlFor="wallet-label">
            钱包名
          </label>
          <input
            id="wallet-label"
            className="field-input"
            placeholder="比如：泰铢现金"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          {/* fix(2026-09-13 Artifact Version 10 落地)：钱包名跟支付方式命名联动——点一下
              已有支付方式的名字直接填进这个输入框，不用重新打一遍。paymentMethods 这个 prop
              本来就是 page.tsx 传下来的真实数据（不是写死名单），这里直接复用，不用新查询。 */}
          {paymentMethods.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[9px] text-muted">
              <span>已有支付方式：</span>
              {paymentMethods.map((m, i) => (
                <span key={m.id}>
                  <button
                    type="button"
                    onClick={() => setLabel(m.label)}
                    className="tap-link text-gold-dk"
                  >
                    {m.label}
                  </button>
                  {i < paymentMethods.length - 1 ? '、' : ''}
                </span>
              ))}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label className="field-label" htmlFor="wallet-currency">
            币种
          </label>
          <SelectDropdown
            id="wallet-currency"
            triggerClassName="field-input w-full"
            value={currency}
            onChange={(next) => {
              setCurrency(next);
              setPaymentMethodId(NO_LINK);
            }}
            options={COMMON_CURRENCIES.map((c) => ({ value: c, label: c }))}
          />
        </div>
      </div>
      {/* fix(2026-09-17 第十九轮)：这个字段之前只在 eligibleMethods.length > 0 时才渲染——
          新建钱包默认币种如果跟已配置的支付方式结算币种不一致（改前默认 MYR，Remy 名下
          唯一一个支付方式是 HKD 现金），下拉就完全消失，独立 ui-auditor 盲测看到的正是
          这种情况，误判成"这个字段整个没做"。现在改成永远渲染这个字段——没有任何一个
          币种匹配的支付方式时，下拉里就只有"不绑定"这一个选项，跟 Artifact 静态原型
          在任何数据状态下都长这个样子的表现一致，不再因为币种选择而整个消失。 */}
      <div className="flex flex-col gap-1">
        <label className="field-label" htmlFor="wallet-payment-method">
          绑定支付方式
        </label>
        <SelectDropdown
          id="wallet-payment-method"
          triggerClassName="field-input w-full"
          value={paymentMethodId}
          onChange={setPaymentMethodId}
          options={[
            { value: NO_LINK, label: '不绑定支付方式（可以之后再绑）' },
            ...eligibleMethods.map((m) => ({
              value: m.id,
              label: `记账选「${m.label}」时自动扣这个钱包`,
            })),
          ]}
        />
      </div>
      {/* fix(2026-09-13 Artifact Version 10 落地，第四轮拍板)：起始余额输入框整个拿掉，
          余额改由「支付方式」页新增的"设置当前余额"功能统一承担（见 payment-methods-manager.tsx）。
          新钱包一律从 0 开始，之后要设余额得去那边操作——这是刻意的依赖关系，不是漏做。 */}
      <div className="flex flex-col gap-1">
        <span className="field-label">账户类型</span>
        <div className="flex flex-wrap items-center gap-1">
          {ICON_CHOICES.map(({ emoji: em, label: emLabel }) => (
            <button
              key={em}
              type="button"
              title={emLabel}
              onClick={() => setEmoji(em)}
              aria-pressed={emoji === em}
              aria-label={`账户类型：${emLabel}`}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm ${
                emoji === em ? 'bg-ink text-paper' : 'bg-white'
              }`}
            >
              {em}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-muted">已选：{selectedIconLabel}</span>
      </div>
      {/* 没套 expense-form.tsx 那个 rounded-xl+bg 提示盒——那个盒子的浅灰底色是靠反衬
          page.tsx 的纯 bg-paper 页面底色出效果的；这个表单本身就是 bg-[rgba(184,158,97,.14)]
          底，同色盒子叠同色底会看不出盒子只剩边框，索性跟 quick-add-expense.tsx 的错误提示
          一样只用纯文字，字号仍收到跟其它说明性小字同一档 10px。 */}
      {error && <p className="text-[10px] text-coral">{error}</p>}
      {/* fix(2026-09-17 第十九轮，独立 ui-auditor 盲测坐实)：Artifact 这一屏是
          `<button class="big-cta">建立钱包</button>`，跟表单等宽，没有旁边贴"取消"——
          之前用 .btn-primary 这个紧凑胶囊+旁边"取消"文字链接，是全站同一批"表单主按钮
          误用紧凑 class"问题的其中一处（另一处是记一笔消费"记这笔账"，一并修了）。
          弹层模式本来就有右上角 ✕ 关闭，这里不用再重复一个"取消"；default 内联变体
          （目前生产环境没在用）保留一个降级的取消文字链接，避免唯一退出方式消失。 */}
      <button type="submit" disabled={submitting} className="big-cta">
        {submitting ? '建立中…' : '建立钱包'}
      </button>
      {!isDark && (
        <button
          type="button"
          onClick={() => setCreating(false)}
          className="tap-link self-center text-[11px] text-muted"
        >
          取消
        </button>
      )}
    </>
  );

  // default（浅色）变体：表单原地内联展开，自己带一层浅底边框盒子（这个盒子的浅灰底
  // 色是靠反衬页面纯 bg-paper 底色出效果的，跟弹层模式的白色卡片底不是一回事）。
  const inlineFormNode = creating && (
    <form onSubmit={handleCreate} className="flex flex-col gap-2 rounded-xl border border-sand bg-[rgba(184,158,97,.14)] p-3">
      {formFields}
    </form>
  );

  return (
    <>
    <div className="flex flex-col gap-2">
      <div className={isDark ? 'flex gap-[7px] overflow-x-auto' : '-mx-4 flex gap-3 overflow-x-auto px-4 pb-1'}>
        {wallets.map((w) =>
          isDark ? (
            <div
              key={w.id}
              className="relative flex min-w-[64px] shrink-0 flex-col gap-[1px] rounded-[9px] bg-white/[.08] px-2 py-[5px]"
            >
              {/* fix(2026-09-18 第二十三轮)：钱包卡这排小胶囊本来就很窄（64px 起），塞不下
                  一颗常驻文字按钮，用角落小图标——同色低透明度不喧宾夺主，点了才需要看清楚，
                  跟支付方式页 🗑 同一个图标语义，只是尺寸缩小配合这里的紧凑卡片。
                  fix(独立 ui-auditor 手机端实测坐实)：第一版图标本身当热区（约13×13px），
                  实测远低于 DESIGN-BRIEF.md 第204行"toolbar icon button 28×28px"这条
                  基准（expense-list.tsx 编辑/删除图标就是照这条做的）——删除是破坏性操作，
                  点不中/误触都比一般按钮更值得较真，这里让热区独立撑到 28×28（h-7 w-7），
                  图标本身视觉尺寸不变（还是 9px 小图标，不会因为热区变大而显得抢戏）。 */}
              <button
                type="button"
                onClick={() => {
                  setDeleteError(null);
                  setConfirmingWallet(w);
                }}
                aria-label={`删除钱包「${w.label}」`}
                className="absolute right-0 top-0 flex h-7 w-7 items-center justify-center text-white/40 transition-colors hover:text-coral"
              >
                <Trash2 className="h-[9px] w-[9px]" aria-hidden="true" />
              </button>
              <div className="flex items-center gap-[3px] pr-[22px] text-[8.5px] text-hero-label">
                <span aria-hidden="true">{w.emoji}</span>
                <span className="truncate">{w.label}</span>
              </div>
              <div className="flex items-baseline gap-[3px]">
                <span className="font-serif text-[11.5px] tabular-nums text-white">
                  {formatMoney(w.currentBalance, w.currency)}
                </span>
                <span className="font-mono text-[7.5px] text-hero-label">{w.currency}</span>
              </div>
            </div>
          ) : (
            <div
              key={w.id}
              className="relative w-[120px] shrink-0 rounded-xl border border-sand bg-[rgba(184,158,97,.14)] px-[9px] py-2"
            >
              <button
                type="button"
                onClick={() => {
                  setDeleteError(null);
                  setConfirmingWallet(w);
                }}
                aria-label={`删除钱包「${w.label}」`}
                className="absolute right-0 top-0 flex h-7 w-7 items-center justify-center text-muted transition-colors hover:text-coral"
              >
                <Trash2 className="h-[11px] w-[11px]" aria-hidden="true" />
              </button>
              <div className="flex items-center gap-1 pr-[22px] text-[10px] font-bold uppercase tracking-wide text-muted">
                <span aria-hidden="true">{w.emoji}</span>
                <span className="truncate">{w.label}</span>
              </div>
              <div className="mt-1 font-serif text-sm font-medium tabular-nums">
                {formatMoney(w.currentBalance, w.currency)}
              </div>
              <div className="font-mono text-[10px] text-muted">{w.currency}</div>
              {w.linkedPaymentMethodLabel && (
                <div className="mt-1 truncate text-[10px] text-gold-dk">🔗 {w.linkedPaymentMethodLabel}</div>
              )}
            </div>
          ),
        )}

        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className={
              isDark
                ? 'flex w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-white/[.06] text-sm text-hero-label'
                : 'flex w-[120px] shrink-0 items-center justify-center rounded-xl border border-dashed border-sand text-xl text-muted'
            }
            aria-label="新建钱包"
          >
            ＋
          </button>
        )}
      </div>

      {/* fix(2026-09-23 第三十七轮，Remy 真实反馈"我的钱包区块不显示内容")：查了真实
          D1 数据，这条真实行程的 wallet 表确实是 0 行，不是代码 bug——但 Remy 已经在
          "支付方式"页配置了现金/Wise 等真实支付方式，会本能以为"我勾过现金了怎么这里
          还是空的"。「钱包(行程专属余额追踪)」跟「支付方式(账号级、汇率比价用)」是两个
          完全不同的东西，这个概念混淆本身值得在空状态时说清楚，不是留一个孤零零的 ＋。
          有已有支付方式时顺手提示"可以直接照抄名字"，呼应下面表单里本来就有的
          "已有支付方式：xx、xx" 快捷链接，不是重造一遍。 */}
      {!creating && wallets.length === 0 && (
        <p className={`text-[9.5px] ${isDark ? 'text-hero-label' : 'text-muted'}`}>
          这趟行程还没建过钱包——钱包是专属这趟行程的余额记录，跟&ldquo;支付方式&rdquo;（账号级，用于汇率比价）是两回事。点 ＋ 建一个
          {paymentMethods.length > 0 ? '，可以直接照抄已有支付方式的名字' : ''}。
        </p>
      )}

      {/* fix(2026-09-24 第三十九轮，团队看板"历史现金消费回溯补算进钱包余额")：round38
          这句话写的是"已经记过的不会补算"，那时候真的是这样（v1 明确的简化边界）。这轮
          实现了创建钱包时的一次性历史回溯（见 `app/api/trips/[tripId]/wallets/route.ts`
          POST 里新增的那段），这句话已经不准确，改成实际行为：建钱包那一刻如果直接绑了
          支付方式，绑定那一刻之前、同支付方式+同币种的历史消费会一次性补进起始余额；
          之后新记的消费持续自动扣。**没有覆盖的边界**（如实说清楚，不夸大）：钱包创建时
          没绑支付方式、之后才手动去绑的情况，中间那段时间记的消费不会自动补——当前产品
          里也没有"创建后改绑支付方式"这个入口，只是留一句话讲清楚，不是刻意藏起来。 */}
      {!creating && wallets.length > 0 && (
        <p className={`text-[9px] ${isDark ? 'text-hero-label' : 'text-muted'}`}>
          建钱包时如果直接绑了支付方式，绑定前的同支付方式+同币种历史消费会一次性补进余额；之后新记的消费持续自动扣。
          {' '}
          {/* fix(2026-09-24 第三十九轮，第四版，真正抓到根因——前三版全部猜错方向)：
              用 Playwright 在生产环境实机插桩（给 `Element.prototype.scrollIntoView`
              打点记录每次调用时的 `getBoundingClientRect` + 调用前后 `scrollY`），逐毫秒
              还原了完整时间线，真相是：①Next Link 默认的 hash 自动滚动（第三版指望的
              机制）确实在 t=732ms 触发了一次，但那一刻 `loadMethods()`/`loadWallets()`
              这两个 fetch 请求还没发出（t=735ms 才发），面板上方"已配置的支付方式"清单
              还是"载入中…"占位，这次滚动因为目标当时已经部分可见被浏览器判定不需要挪动，
              `scrollY` 前后都是 0，白打一次；②数据在 t=990~1000ms 到齐后，这份文件自己
              的 `useEffect`（下面那个）在 t=1004ms 正确触发了 `scrollIntoView({block:
              'start'})`，而且这次目标元素的 `getBoundingClientRect` 量出来的绝对位置
              （877px）是对的——**但滚动结果只到 281px 就不动了**。原因不是时机，是纯
              几何限制：这一页此时的 `document.documentElement.scrollHeight` 是
              1125px，视口高度 844px，`1125-844=281`，跟卡住的位置分毫不差——**浏览器
              没法把一个只比视口高一点点的页面，滚到让接近页面末尾的区块贴到视口顶部**，
              物理上滚动距离不够，跟 `scrollIntoView` 传不传 `{block:'start'}`、算不算
              准时机完全无关，前三版全部在错误的维度上找答案。已用同一份生产代码实测
              验证：往 `document.body` 尾部插一个 100vh 的占位块，同一次 `scrollIntoView`
              调用立刻能精确滚到 `elTop≈0`。这次真正的修法在
              `payment-methods-manager.tsx`（下面那个组件本体，占位块加在那边）——这里
              只做一件事：`Link` 加回 `scroll={false}`（第二版加过、第三版又去掉的那个
              开关，这次证实 Next 自己的默认滚动确实没用，还会在 t=732ms 抢先摸一次这个
              目标元素占用一次浏览器的"要不要滚"判定，干脆继续关掉，交给下面那个已经证明
              有效的自定义 `useEffect` 全权处理），并去掉已经证明没用的 `#set-balance`
              hash（滚动这次改成完全不依赖浏览器的原生 hash 定位）。 */}
          <Link href={`/trips/${tripId}/payment-methods?openBalance=1`} scroll={false} className="tap-link">
            去&ldquo;支付方式&rdquo;手动设置余额 →
          </Link>
        </p>
      )}

      {/* default 模式表单原地内联展开；embedded-dark 模式表单走下面的弹层 modal（见上面的
          注释——Artifact 侧栏标题写的是"新建钱包（弹层）"，不是内联展开）。 */}
      {!isDark && inlineFormNode}
      {deleteError && (
        <p className={isDark ? 'text-[9px] text-negative-dk' : 'text-[10px] text-coral'}>{deleteError}</p>
      )}
    </div>
    <ConfirmDialog
      open={confirmingWallet !== null}
      message={
        confirmingWallet
          ? confirmingWallet.currentBalance !== 0
            ? `「${confirmingWallet.label}」目前还有余额 ${formatMoney(confirmingWallet.currentBalance, confirmingWallet.currency)}，删除后这笔余额会直接消失（不会自动转到别的钱包，也不会留下任何记录）。确定要删除吗？`
            : `确定要删除钱包「${confirmingWallet.label}」吗？这个操作不能撤销。`
          : ''
      }
      confirmLabel={deleting ? '删除中…' : '删除'}
      onConfirm={performDeleteWallet}
      onCancel={() => setConfirmingWallet(null)}
    />
    {isDark && creating && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 px-0 sm:items-center sm:px-4"
            role="dialog"
            aria-modal="true"
            aria-label="新建钱包"
            onClick={() => setCreating(false)}
          >
            <div
              className="max-h-[85vh] w-full max-w-[380px] overflow-y-auto rounded-t-[20px] border border-sand bg-paper p-4 shadow-card sm:rounded-[20px]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-[15px] font-bold text-ink">新建钱包</h3>
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  aria-label="关闭"
                  className="tap-link text-[12.5px] text-muted"
                >
                  ✕
                </button>
              </div>
              <form onSubmit={handleCreate} className="flex flex-col gap-2">
                {formFields}
              </form>
            </div>
          </div>,
          document.body,
        )
      : null}
    </>
  );
}
