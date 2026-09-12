'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { COMMON_CURRENCIES } from '@/lib/currencies';
import { yuanToCents, centsToYuan, formatMoney } from '@/lib/money';
import { equalSplit, rescaleSplitToBaseCurrency } from '@/lib/domain/split';
import type { SplitShare } from '@/lib/domain/split';
import { COMMON_CATEGORIES } from '@/lib/domain/categories';
import type { FxRecommendationResult } from '@/lib/domain/fx-recommendation';
import { FxCompareList } from '../fx-compare-list';
import { CategoryCombobox } from '@/components/category-combobox';

interface Participant {
  id: string;
  displayName: string;
}

export interface InitialExpense {
  id: string;
  amount: number; // 原始币种最小货币单位
  currency: string;
  payerParticipantId: string;
  category: string;
  merchant: string | null;
  note: string | null;
  expenseDate: string; // ISO
  fxRateUsed: number;
  amountBaseCurrency: number;
  hasReceipt: boolean;
  splits: SplitShare[];
  paymentMethodId: string | null;
}

export type SplitMode = 'onlyMe' | 'equal' | 'custom';

const SPLIT_MODE_OPTIONS: { value: SplitMode; label: string }[] = [
  { value: 'onlyMe', label: '仅我自己' },
  { value: 'equal', label: '平分' },
  { value: 'custom', label: '自定义分摊' },
];

/**
 * 编辑一笔已有消费时，从数据库存的 splits（本位币金额）反推表单要用的原生币种
 * 分摊金额和当初是哪一档分摊模式——DB 只存本位币份额，不存用户当初输入的原生
 * 币种拆法，这里按这笔消费自己的 amount/amountBaseCurrency 比例换算回去，只作
 * 初始展示值，可能有几分钱的舍入误差；真正提交时会用 rescaleSplitToBaseCurrency
 * 重新精确换算，不依赖这里的结果。
 *
 * 三档判断顺序：先看是不是全员等分（默认档），再看是不是「只有代垫人自己一个人、
 * 份额等于全额」（仅我自己档，2026-09-12 新增），剩下的才归自定义分摊。
 */
function deriveInitialSplitState(initialExpense: InitialExpense, participants: Participant[]) {
  const allIds = participants.map((p) => p.id);
  const equalShares = equalSplit(initialExpense.amountBaseCurrency, allIds);
  const equalMap = new Map(equalShares.map((s) => [s.participantId, s.shareAmountBaseCurrency]));
  const isDefaultEqualSplit =
    initialExpense.splits.length === allIds.length &&
    initialExpense.splits.every((s) => equalMap.get(s.participantId) === s.shareAmountBaseCurrency);

  if (isDefaultEqualSplit) {
    return {
      splitMode: 'equal' as const,
      splitIncluded: Object.fromEntries(allIds.map((id) => [id, true])),
      splitAmounts: {} as Record<string, string>,
    };
  }

  const isOnlyPayer =
    initialExpense.splits.length === 1 &&
    initialExpense.splits[0]?.participantId === initialExpense.payerParticipantId &&
    initialExpense.splits[0]?.shareAmountBaseCurrency === initialExpense.amountBaseCurrency;

  if (isOnlyPayer) {
    return {
      splitMode: 'onlyMe' as const,
      splitIncluded: Object.fromEntries(allIds.map((id) => [id, id === initialExpense.payerParticipantId])),
      splitAmounts: {} as Record<string, string>,
    };
  }

  const splitByParticipant = new Map(initialExpense.splits.map((s) => [s.participantId, s.shareAmountBaseCurrency]));
  const splitIncluded = Object.fromEntries(allIds.map((id) => [id, splitByParticipant.has(id)]));
  const splitAmounts = Object.fromEntries(
    initialExpense.splits.map((s) => {
      const nativeCents =
        initialExpense.amountBaseCurrency === 0
          ? 0
          : Math.round((s.shareAmountBaseCurrency * initialExpense.amount) / initialExpense.amountBaseCurrency);
      return [s.participantId, String(centsToYuan(nativeCents))];
    })
  );

  return { splitMode: 'custom' as const, splitIncluded, splitAmounts };
}

export function ExpenseForm({
  tripId,
  baseCurrency,
  myParticipantId,
  participants,
  hasPaymentMethods,
  initialExpense,
}: {
  tripId: string;
  baseCurrency: string;
  myParticipantId: string;
  participants: Participant[];
  hasPaymentMethods: boolean;
  initialExpense?: InitialExpense;
}) {
  const router = useRouter();
  const isEdit = initialExpense !== undefined;
  const initialSplitState = initialExpense ? deriveInitialSplitState(initialExpense, participants) : null;

  const [amountYuan, setAmountYuan] = useState(initialExpense ? String(centsToYuan(initialExpense.amount)) : '');
  const [currency, setCurrency] = useState(initialExpense?.currency ?? baseCurrency);
  const [payerParticipantId, setPayerParticipantId] = useState(initialExpense?.payerParticipantId ?? myParticipantId);
  const [category, setCategory] = useState(initialExpense?.category ?? '');
  const [merchant, setMerchant] = useState(initialExpense?.merchant ?? '');
  const [expenseDate, setExpenseDate] = useState(
    initialExpense ? initialExpense.expenseDate.slice(0, 10) : new Date().toISOString().slice(0, 10)
  );
  const [note, setNote] = useState(initialExpense?.note ?? '');
  const [fxRateUsed, setFxRateUsed] = useState(
    initialExpense && initialExpense.fxRateUsed !== 1 ? String(initialExpense.fxRateUsed) : ''
  );
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [comparing, setComparing] = useState(false);
  const [recommendations, setRecommendations] = useState<FxRecommendationResult[] | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState<string | null>(
    initialExpense?.paymentMethodId ?? null
  );

  const [splitMode, setSplitMode] = useState<SplitMode>(initialSplitState?.splitMode ?? 'equal');
  const [splitIncluded, setSplitIncluded] = useState<Record<string, boolean>>(
    initialSplitState?.splitIncluded ?? Object.fromEntries(participants.map((p) => [p.id, true]))
  );
  const [splitAmounts, setSplitAmounts] = useState<Record<string, string>>(initialSplitState?.splitAmounts ?? {});

  const needsManualFxRate = currency !== baseCurrency;

  const amountCentsTotal = yuanToCents(Number(amountYuan) || 0);
  const includedParticipants = participants.filter((p) => splitIncluded[p.id]);
  const splitCentsTotal = includedParticipants.reduce(
    (sum, p) => sum + yuanToCents(Number(splitAmounts[p.id]) || 0),
    0
  );
  const splitMismatch = splitMode === 'custom' && splitCentsTotal !== amountCentsTotal;

  function handleSelectSplitMode(mode: SplitMode) {
    setSplitMode(mode);
    // 第一次点开自定义分摊且还没填过分摊金额时，先按当前金额平均分好，免得一打开就要
    // 面对空白/总和为 0 的红字。
    if (mode === 'custom' && Object.keys(splitAmounts).length === 0 && amountCentsTotal > 0 && includedParticipants.length > 0) {
      handleEqualizeSplit();
    }
  }

  function handleEqualizeSplit() {
    if (includedParticipants.length === 0) return;
    const shares = equalSplit(amountCentsTotal, includedParticipants.map((p) => p.id));
    setSplitAmounts((prev) => {
      const next = { ...prev };
      for (const s of shares) {
        next[s.participantId] = String(centsToYuan(s.shareAmountBaseCurrency));
      }
      return next;
    });
  }

  async function handleCompare() {
    setCompareError(null);
    setRecommendations(null);
    if (!hasPaymentMethods) {
      setCompareError('no_payment_methods');
      return;
    }
    const amount = Number(amountYuan);
    if (!amount || amount <= 0) {
      setCompareError('先填金额再比价');
      return;
    }
    setComparing(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/fx-recommendation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: yuanToCents(amount), expenseCurrency: currency }),
      });
      if (res.status === 400) {
        const body = await (res.json() as Promise<any>).catch(() => null);
        if (body?.error === 'no_payment_methods') {
          setCompareError('no_payment_methods');
          return;
        }
        setCompareError('比价失败，检查一下金额/币种');
        return;
      }
      if (!res.ok) {
        setCompareError('比价失败，检查一下金额/币种');
        return;
      }
      const data = (await res.json()) as any;
      setRecommendations(data.recommendations);
      // 每次重新比价都清掉已选定的支付方式：金额/币种可能变了，旧的选择不一定还成立。
      setSelectedPaymentMethodId(null);
    } finally {
      setComparing(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const amount = Number(amountYuan);
    if (!amount || amount <= 0) {
      setError('金额要大于 0');
      return;
    }
    if (needsManualFxRate && !fxRateUsed) {
      setError(`币种不是本位币 ${baseCurrency}，要填汇率（1 ${currency} = 多少 ${baseCurrency}）`);
      return;
    }
    if (!category.trim()) {
      setError('分类不能空着');
      return;
    }

    const amountCents = yuanToCents(amount);
    const amountBaseCurrency = needsManualFxRate ? Math.round(amountCents * Number(fxRateUsed)) : amountCents;

    let splits: SplitShare[] | undefined;

    if (splitMode === 'onlyMe') {
      // 「仅我自己」= 分摊名单收窄成代垫人一个人、份额是全额，复用跟自定义分摊
      // 一样的 SplitShare[] 结构，不新造数据模型。
      splits = equalSplit(amountBaseCurrency, [payerParticipantId]);
    } else if (splitMode === 'custom') {
      const included = participants.filter((p) => splitIncluded[p.id]);
      if (included.length === 0) {
        setError('自定义分摊至少要选一个人');
        return;
      }
      const nativeShares = included.map((p) => ({
        participantId: p.id,
        amountNativeCents: yuanToCents(Number(splitAmounts[p.id]) || 0),
      }));
      const nativeSum = nativeShares.reduce((sum, s) => sum + s.amountNativeCents, 0);
      if (nativeSum !== amountCents) {
        setError('自定义分摊金额总和要等于消费总金额');
        return;
      }
      splits = rescaleSplitToBaseCurrency(nativeShares, amountBaseCurrency);
    } else if (isEdit) {
      // 编辑时金额/币种字段一定会被重传，PATCH 要求「金额一变就必须同时带 splits」，
      // 这里补上默认等分，跟创建时后端自己算的默认行为保持一致。
      splits = equalSplit(amountBaseCurrency, participants.map((p) => p.id));
    }

    setSubmitting(true);
    try {
      const endpoint = isEdit
        ? `/api/trips/${tripId}/expenses/${initialExpense.id}`
        : `/api/trips/${tripId}/expenses`;

      const res = await fetch(endpoint, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          payerParticipantId,
          amount: amountCents,
          currency,
          fxRateUsed: needsManualFxRate ? Number(fxRateUsed) : undefined,
          paymentMethodId: selectedPaymentMethodId ?? undefined,
          category: category.trim(),
          // 一律显式传（不像 note 那样空值转 undefined）：编辑时要能靠传空字符串
          // 清空已有商家名，undefined 在 PATCH 语义里是「不改这个字段」，两者不能混用。
          merchant: merchant.trim(),
          note: note.trim() || undefined,
          expenseDate: new Date(expenseDate).toISOString(),
          splits,
        }),
      });

      if (!res.ok) {
        setError('提交失败，检查一下表单内容');
        return;
      }

      const expenseId = isEdit ? initialExpense.id : ((await res.json()) as any).expense.id;

      if (receiptFile) {
        const form = new FormData();
        form.append('file', receiptFile);
        await fetch(`/api/expenses/${expenseId}/receipt`, { method: 'POST', body: form });
      }

      router.push(`/trips/${tripId}`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // noValidate: 理由跟 quick-add-expense.tsx 一样——金额输入框的 min="0.01"/required
    // 这类 HTML5 constraint 会在 preventDefault 生效前被浏览器抢先拦截弹原生英文气泡
    // （"填 0"这个具体数值就是被 min 挡住，只有"留空"能落到下面 JS 校验），关掉原生
    // 校验统一交给已经写好的中文错误提示处理。
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="field-label" htmlFor="amount">
            金额
          </label>
          <input
            id="amount"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={amountYuan}
            onChange={(e) => setAmountYuan(e.target.value)}
            placeholder="0.00"
            className="field-input font-serif font-medium tabular-nums"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="field-label" htmlFor="currency">
            币种
          </label>
          <select
            id="currency"
            value={currency}
            onChange={(e) => {
              setCurrency(e.target.value);
              setRecommendations(null);
            }}
            className="field-input"
          >
            {Array.from(new Set([baseCurrency, ...COMMON_CURRENCIES])).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {needsManualFxRate && (
        <div className="flex flex-col gap-1">
          <label className="field-label" htmlFor="fx-rate">
            汇率（1 {currency} = 多少 {baseCurrency}）
          </label>
          <input
            id="fx-rate"
            type="number"
            min="0"
            step="0.0001"
            value={fxRateUsed}
            onChange={(e) => setFxRateUsed(e.target.value)}
            placeholder="手动输入，比价拉不到当日汇率也不影响记账"
            className="field-input"
          />
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-xl border border-sand bg-paper p-3">
        <div className="flex items-center justify-between">
          <span className="field-label">这笔用哪张卡最划算？</span>
          <button
            type="button"
            onClick={handleCompare}
            disabled={comparing || !hasPaymentMethods}
            className="btn-secondary"
          >
            {comparing ? '比价中…' : '比价'}
          </button>
        </div>
        {(!hasPaymentMethods || compareError === 'no_payment_methods') && (
          <p className="text-[10px] text-muted">
            还没配置支付方式，先去{' '}
            <Link href={`/trips/${tripId}/payment-methods`} className="tap-link">
              支付方式设置
            </Link>{' '}
            配一下。
          </p>
        )}
        {/* fix(2026-09-12 走查)：之前是裸红字文字直接摆在浅色边框盒子里（text-base 16px
            + text-coral，没有自己的容器），很原生很粗糙。改用 app/page.tsx 第75行「身份链接
            失效」提示已经在用的盒子写法（rounded-xl border-sand + card-tint 底，跟 .tx-item
            同一套容器语言，只是文字换成 coral），不新发明一套错误样式；字号按这个文件字号
            走查统一到 10px（副信息/caption 档），跟下面"点一张卡标记…"同一档。 */}
        {compareError && compareError !== 'no_payment_methods' && (
          <p className="rounded-xl border border-sand bg-[rgba(164,163,160,.14)] px-[9px] py-[5px] text-[10px] text-coral">
            {compareError}
          </p>
        )}
        {recommendations && (
          <div className="flex flex-col gap-2">
            <FxCompareList
              recommendations={recommendations}
              compareCurrency={baseCurrency}
              selectedPaymentMethodId={selectedPaymentMethodId}
              onSelect={setSelectedPaymentMethodId}
            />
            <p className="text-[10px] text-muted">点一张卡标记「这笔实际用它」，记账时会自动扣对应钱包余额。</p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="field-label" htmlFor="payer">
          谁代垫的
        </label>
        <select
          id="payer"
          value={payerParticipantId}
          onChange={(e) => setPayerParticipantId(e.target.value)}
          className="field-input"
        >
          {participants.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="field-label" htmlFor="category">
          分类
        </label>
        <CategoryCombobox
          id="category"
          required
          value={category}
          onChange={setCategory}
          options={COMMON_CATEGORIES}
          placeholder="例如：餐饮"
          inputClassName="field-input"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="field-label" htmlFor="merchant">
          商家名称（可选）
        </label>
        <input
          id="merchant"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
          placeholder="例如：星巴克"
          className="field-input"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="field-label" htmlFor="expense-date">
          日期
        </label>
        <input
          id="expense-date"
          type="date"
          required
          value={expenseDate}
          onChange={(e) => setExpenseDate(e.target.value)}
          className="field-input"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="field-label" htmlFor="note">
          备注（可选）
        </label>
        <textarea
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="field-input"
          rows={2}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="field-label" htmlFor="receipt">
          收据（可选{isEdit && initialExpense.hasReceipt ? '，已有收据，上传新文件会替换' : ''}）
        </label>
        <input
          id="receipt"
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.pdf"
          onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
          className="text-[12.5px]"
        />
      </div>

      {/* fix(2026-09-12 字号走查)：这个盒子内部原本 text-base(16px)/text-sm(14px)/
          text-xs(12px) 三种字号混着用，逐个对齐 DESIGN-SYSTEM-INTERNAL.md 字号阶梯：
          "自定义分摊"是这个盒子的小节标题，跟上面"这笔用哪张卡最划算？"同类角色，改用
          field-label 同款 10px；同行人姓名/金额是清单主内容，对齐 field-input 的
          12.5px；说明性小字（默认平分提示/币种单位/已分配汇总）统一收进 10px 副信息档。
          fix(2026-09-12 分摊逻辑反馈)：原本只有"自定义分摊"勾选框，不勾默认强制全员
          平分——纯粹自己的消费也被逼着分给同行者。改成三档单选（仅我自己/平分/自定义
          分摊），"仅我自己"不新造数据结构，复用跟自定义分摊一样的 SplitShare[]。 */}
      <div className="flex flex-col gap-2 rounded-xl border border-sand bg-paper p-3">
        <span className="field-label">这笔怎么分摊</span>
        <div className="flex flex-wrap gap-1.5">
          {SPLIT_MODE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleSelectSplitMode(opt.value)}
              aria-pressed={splitMode === opt.value}
              className={
                splitMode === opt.value
                  ? 'inline-flex min-h-[28px] shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-accent-700 px-[10px] text-[10px] font-medium text-white transition-colors'
                  : 'inline-flex min-h-[28px] shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-sand bg-white px-[10px] text-[10px] font-medium text-muted transition-colors hover:text-ink'
              }
            >
              {opt.label}
            </button>
          ))}
        </div>

        {splitMode === 'equal' && <p className="text-[10px] text-muted">默认所有参与者平均分摊这笔消费。</p>}
        {splitMode === 'onlyMe' && (
          <p className="text-[10px] text-muted">
            这笔只算在「谁代垫的」自己头上，不分给其他同行者——适合纯粹自己的消费。
          </p>
        )}

        {splitMode === 'custom' && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              {participants.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={splitIncluded[p.id] ?? true}
                    onChange={(e) =>
                      setSplitIncluded((prev) => ({ ...prev, [p.id]: e.target.checked }))
                    }
                  />
                  <span className="w-24 shrink-0 text-[12.5px]">{p.displayName}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={!(splitIncluded[p.id] ?? true)}
                    value={splitAmounts[p.id] ?? ''}
                    onChange={(e) =>
                      setSplitAmounts((prev) => ({ ...prev, [p.id]: e.target.value }))
                    }
                    placeholder="0.00"
                    className="field-input w-28"
                  />
                  <span className="text-[10px] text-muted">{currency}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleEqualizeSplit}
                className="btn-secondary shrink-0 whitespace-nowrap"
              >
                平均分给已勾选的人
              </button>
              <span className={`text-[10px] tabular-nums ${splitMismatch ? 'text-coral' : 'text-ok'}`}>
                已分配 {formatMoney(splitCentsTotal, currency)} / 共 {formatMoney(amountCentsTotal, currency)}
              </span>
            </div>
            {splitMismatch && (
              <p className="rounded-xl border border-sand bg-[rgba(164,163,160,.14)] px-[9px] py-[5px] text-[10px] text-coral">
                分摊总和要跟消费总金额完全一致才能提交。
              </p>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-xl border border-sand bg-[rgba(164,163,160,.14)] px-[9px] py-[5px] text-[10px] text-coral">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting || splitMismatch}
          className="btn-primary"
        >
          {submitting ? '保存中…' : isEdit ? '保存修改' : '记这笔账'}
        </button>
        {isEdit && (
          <Link href={`/trips/${tripId}`} className="tap-link text-[12.5px] text-muted">
            取消
          </Link>
        )}
      </div>
    </form>
  );
}
