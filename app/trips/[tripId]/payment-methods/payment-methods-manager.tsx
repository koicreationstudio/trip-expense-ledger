'use client';

import { useEffect, useState } from 'react';
import { PAYMENT_METHOD_SETTLEMENT_CURRENCIES } from '@/lib/currencies';
import { yuanToCents, centsToYuan, formatMoney } from '@/lib/money';
import { ConfirmDialog } from '@/components/confirm-dialog';

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

export function PaymentMethodsManager({ tripId }: { tripId: string }) {
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
  const [balancePanelOpen, setBalancePanelOpen] = useState(false);

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
        {/* fix(2026-09-16 第十八轮)：小标题统一成 Artifact `section.blk h4` 规格。 */}
        <h2 className="text-[10px] font-medium tracking-[0.08em] text-gold-dk">已配置的支付方式</h2>
        {methods === null ? (
          <p className="text-xs text-muted">载入中…</p>
        ) : methods.length === 0 ? (
          <p className="text-xs text-muted">还没配置任何支付方式。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {methods.map((m) => (
              <li key={m.id} className="tx-item justify-between">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-circle text-sm"
                    aria-hidden="true"
                  >
                    {m.kind === 'card' ? '💳' : '💵'}
                  </span>
                  <div className="flex min-w-0 flex-col">
                    {/* fix(2026-09-15)：这行字号原本 12.5px，比页面其它次级文字（8.5-9.5px）
                        明显突兀，对齐 Artifact `#scr-payment .nm{font-size:10px}` 改成 10px。 */}
                    <span className="text-[10px] font-medium">
                      {m.label}（{m.kind === 'card' ? '卡' : '现金'} · {m.settlementCurrency}）
                    </span>
                    <span className="mt-0.5 border-t border-dashed border-sand pt-1 text-[10px] text-muted">
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
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmingId(m.id)}
                  className="btn-secondary shrink-0"
                >
                  删除
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
        <h2 className="text-[10px] font-medium tracking-[0.08em] text-gold-dk">本行程启用的支付方式</h2>
        <p className="text-[10px] text-muted">这行程要用到哪几张卡/钱包，不用的可以取消勾选，记账时下拉选单会更短。</p>
        {methods === null ? (
          <p className="text-xs text-muted">载入中…</p>
        ) : methods.length === 0 ? (
          <p className="text-xs text-muted">还没配置任何支付方式，先在下面新增一个。</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {methods.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-2 rounded-xl border border-sand bg-[rgba(164,163,160,.14)] px-[9px] py-[5px]"
              >
                <input
                  id={`pm-enabled-${m.id}`}
                  type="checkbox"
                  checked={m.enabled}
                  disabled={togglingId === m.id}
                  onChange={() => handleToggleEnabled(m)}
                />
                <label htmlFor={`pm-enabled-${m.id}`} className="flex-1 text-[11px]">
                  {m.label}（{m.kind === 'card' ? '卡' : '现金'} · {m.settlementCurrency}）
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[10px] font-medium tracking-[0.08em] text-gold-dk">新增支付方式</h2>
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
              <select
                id="pm-kind"
                value={form.kind}
                onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as 'card' | 'cash' }))}
                className="field-input"
              >
                <option value="card">卡</option>
                <option value="cash">现金</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="field-label" htmlFor="pm-currency">
              结算币种
            </label>
            <select
              id="pm-currency"
              value={form.settlementCurrency}
              onChange={(e) => setForm((f) => ({ ...f, settlementCurrency: e.target.value }))}
              className="field-input"
            >
              {PAYMENT_METHOD_SETTLEMENT_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
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

          <button
            type="submit"
            disabled={submitting}
            className="btn-primary"
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
      <section className="flex flex-col gap-2">
        <button type="button" onClick={() => setBalancePanelOpen((v) => !v)} className="btn-primary">
          ⚙ 设置当前余额
        </button>
        {balancePanelOpen && (
          <div className="flex flex-col gap-2">
            <p className="text-[10px] text-muted">
              这里改的是这趟行程里每个钱包的余额（不是上面账号级的支付方式费率配置）。
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
