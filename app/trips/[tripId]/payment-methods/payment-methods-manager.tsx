'use client';

import { useEffect, useState } from 'react';
import { PAYMENT_METHOD_SETTLEMENT_CURRENCIES } from '@/lib/currencies';
import { yuanToCents, centsToYuan, formatMoney } from '@/lib/money';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { SelectDropdown } from '@/components/select-dropdown';

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
  const [methods, setMethods] = useState<PaymentMethod[] | null>(null);
  const [form, setForm] = useState(emptyForm);
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
  const [balanceDate, setBalanceDate] = useState('');
  const [balanceSubmitting, setBalanceSubmitting] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  // fix(2026-09-14 Artifact Version 10 走查补做)：Artifact 里"设置当前余额"是页面
  // 底部一颗按钮，点开才展开钱包余额清单——不是像这里之前那样常驻在页面最上面的一整块。
  const [balancePanelOpen, setBalancePanelOpen] = useState(defaultOpenBalancePanel);

  // fix(2026-09-23 第三十八轮，ui-auditor 真机走查坐实：第一版只用一次 useEffect + 直接
  // scrollIntoView，落地后页面纹丝不动还是停在顶部)：根因是 Next.js Link 导航自带一次
  // "滚回页面顶部"的行为，时机跟这个 effect 差不多同一帧，两边抢滚动位置，我这边即使
  // 真的调用了 scrollIntoView 也会被随后（或几乎同时）的默认滚动重置抢跑覆盖掉——
  // 这次同时做两件事：①调用方（wallet-grid.tsx 的 Link）加 `scroll={false}` 关掉
  // Next 那次默认滚动，不再有人跟这里抢 ②这边改用两层 requestAnimationFrame（等一次
  // 完整的布局/绘制周期过去，而不是 effect 跑完那一刻 DOM 几何信息还没稳定）再滚，
  // 比 mount 那一刻立刻滚更可靠。
  useEffect(() => {
    if (!defaultOpenBalancePanel) return;
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        document.getElementById('set-balance')?.scrollIntoView({ block: 'start' });
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [defaultOpenBalancePanel]);

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
    setBalanceYuan(String(centsToYuan(w.currentBalance)));
    setBalanceDate(new Date().toISOString().slice(0, 10));
    setBalanceError(null);
  }

  async function handleSetBalance(walletId: string) {
    setBalanceError(null);
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
          balanceUpdatedAt: balanceDate ? new Date(balanceDate).toISOString() : undefined,
        }),
      });
      if (!res.ok) {
        setBalanceError('更新失败，检查一下金额');
        return;
      }
      setEditingWalletId(null);
      await loadWallets();
    } finally {
      setBalanceSubmitting(false);
    }
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

  return (
    // fix(2026-09-16 第十七轮)：gap-8(32px) 收到 gap-2.5(10px)，理由同 invites-manager.tsx。
    <div className="flex flex-col gap-2.5">
      <section className="flex flex-col gap-2">
        {/* fix(2026-09-16 第十八轮)：小标题统一成 Artifact `section.blk h4` 规格。
            fix(2026-09-18 第二十五轮)：读 Artifact 源码发现支付方式屏有专属 scoped
            override `#scr-payment section.blk h4{font-size:9px}`（比通用的 10px
            再收一档），round18 当时只套用了通用 10px 版本，没查到这条页面专属覆盖，
            这次三处小标题全部改成字面一致的 9px。 */}
        <h2 className="text-[9px] font-medium tracking-[0.08em] text-gold-dk">已配置的支付方式</h2>
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
          <ul className="flex flex-col gap-[2px] rounded-[14px] border border-sand bg-[rgba(184,158,97,.14)] px-[5px] py-[3px] shadow-card">
            {methods.map((m) => (
              <li key={m.id} className="flex items-center gap-[5px] py-[3px]">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-circle text-sm"
                  aria-hidden="true"
                >
                  {m.kind === 'card' ? '💳' : '💵'}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  {/* Artifact `#scr-payment .nm{font-size:10px}` */}
                  <span className="text-[10px] font-medium">
                    {m.label}（{m.kind === 'card' ? '卡' : '现金'} · {m.settlementCurrency}）
                  </span>
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
        <h2 className="text-[9px] font-medium tracking-[0.08em] text-gold-dk">本行程启用的支付方式</h2>
        <p className="text-[10px] text-muted">这行程要用到哪几张卡/钱包，不用的可以取消勾选，记账时下拉选单会更短。</p>
        {methods === null ? (
          <p className="text-xs text-muted">载入中…</p>
        ) : methods.length === 0 ? (
          <p className="text-xs text-muted">还没配置任何支付方式，先在下面新增一个。</p>
        ) : (
          // fix(2026-09-17 第二十一轮)：同上——这里也改成共用 `.list` 容器包
          // `.check-row`（`font-size:10.5px`），不再是每行各自一个独立描边胶囊。
          <ul className="flex flex-col gap-[2px] rounded-[14px] border border-sand bg-[rgba(184,158,97,.14)] px-[5px] py-[3px] shadow-card">
            {methods.map((m) => (
              <li key={m.id} className="flex items-center gap-[5px] py-[3px]">
                <input
                  id={`pm-enabled-${m.id}`}
                  type="checkbox"
                  checked={m.enabled}
                  disabled={togglingId === m.id}
                  onChange={() => handleToggleEnabled(m)}
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
        <h2 className="text-[9px] font-medium tracking-[0.08em] text-gold-dk">新增支付方式</h2>
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
                type="number"
                step="0.01"
                min="0"
                value={form.fixedFeeYuan}
                onChange={(e) => setForm((f) => ({ ...f, fixedFeeYuan: e.target.value }))}
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
        {/* fix(2026-09-17 第十九轮)：跟上面同一批"改成 .big-cta 全宽"，颜色沿用 Artifact
            `style="background:var(--gold-dk)"`——跟"添加支付方式"那颗纯黑主按钮区分开，
            是方案里同一颗按钮组件的第二种配色，不是新发明的按钮样式。图标 ⚙（0x2699）
            核对过就是 Artifact 原文用的字符，不是 ⊙，这次没有改图标本身。 */}
        <button
          type="button"
          onClick={() => setBalancePanelOpen((v) => !v)}
          className="big-cta"
          style={{ backgroundColor: '#7E6630' }}
        >
          ⚙ 设置当前余额
        </button>
        {balancePanelOpen && (
          <div className="flex flex-col gap-2">
            {/* fix(2026-09-23 第三十八轮，Remy 真实反馈"记了很多现金消费，钱包余额还是0"）：
                之前这句只说了"改的是钱包不是支付方式"，没说清楚余额跟消费记录之间到底有没有
                关系——真实数据查证过，钱包如果绑了支付方式，之后新记的同支付方式消费会自动
                扣这个钱包，但不会回溯计算绑定之前已经记过的消费。这句话补上这层，不然"我明明
                记了很多现金消费"这个真实困惑还是没被回答。 */}
            <p className="text-[10px] text-muted">
              这里改的是这趟行程里每个钱包的余额（不是上面账号级的支付方式费率配置）。钱包如果绑了支付方式，之后新记的同支付方式消费会自动从这里扣；已经记过的消费不会补算，第一次用要自己先对一次余额。
            </p>
            {wallets === null ? (
              <p className="text-xs text-muted">载入中…</p>
            ) : wallets.length === 0 ? (
              <p className="text-xs text-muted">还没建过钱包，先去行程主页新建。</p>
            ) : visibleWallets.length === 0 ? (
              <p className="text-xs text-muted">
                这趟行程建过的钱包都绑着已取消勾选的支付方式，去上面「本行程启用的支付方式」重新勾选看看。
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {visibleWallets.map((w) => (
                  <li key={w.id} className="tx-item flex-col items-stretch gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium">
                        <span aria-hidden="true">{w.emoji}</span>
                        <span className="truncate">{w.label}</span>
                        <span className="font-mono text-[9px] text-muted">{w.currency}</span>
                      </span>
                      {editingWalletId !== w.id && (
                        <button type="button" onClick={() => startEditBalance(w)} className="btn-secondary shrink-0">
                          设置当前余额
                        </button>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-serif text-[12.5px] tabular-nums">{formatMoney(w.currentBalance, w.currency)}</span>
                      {w.balanceUpdatedAt && (
                        <span className="text-[9px] text-muted">
                          最近记录 {new Date(w.balanceUpdatedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {editingWalletId === w.id && (
                      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-sand bg-white p-2">
                        <div className="flex flex-col gap-1">
                          <label className="field-label" htmlFor={`wallet-balance-${w.id}`}>
                            当前余额（{w.currency}）
                          </label>
                          <input
                            id={`wallet-balance-${w.id}`}
                            type="number"
                            step="0.01"
                            value={balanceYuan}
                            onChange={(e) => setBalanceYuan(e.target.value)}
                            className="field-input w-28 font-serif tabular-nums"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="field-label" htmlFor={`wallet-balance-date-${w.id}`}>
                            记录日期
                          </label>
                          <input
                            id={`wallet-balance-date-${w.id}`}
                            type="date"
                            value={balanceDate}
                            onChange={(e) => setBalanceDate(e.target.value)}
                            className="field-input"
                          />
                        </div>
                        <button
                          type="button"
                          disabled={balanceSubmitting}
                          onClick={() => handleSetBalance(w.id)}
                          className="btn-secondary"
                        >
                          {balanceSubmitting ? '保存中…' : '保存'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingWalletId(null)}
                          className="tap-link text-[11px] text-muted"
                        >
                          取消
                        </button>
                        {balanceError && <p className="w-full text-[10px] text-coral">{balanceError}</p>}
                      </div>
                    )}
                  </li>
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
