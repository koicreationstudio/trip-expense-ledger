'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { COMMON_CURRENCIES } from '@/lib/currencies';
import { yuanToCents, centsToYuan, formatMoney } from '@/lib/money';
import { equalSplit, rescaleSplitToBaseCurrency } from '@/lib/domain/split';
import type { SplitShare } from '@/lib/domain/split';
import { COMMON_CATEGORIES } from '@/lib/domain/categories';
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

// fix(2026-09-14 Artifact Version 10 走查补做)：Version 10 这一屏的分摊控件是一个
// 「跟其他人 split 这笔」开关（.switch），不是三段式按钮——三段式按钮是行程主页
// 「快速记账」那个不同屏幕该用的组件（.seg3），这里不能照抄。开关关掉＝onlyMe，
// 不新增数据模型；开关打开后，「谁垫的钱？」这个统一区块里才需要在 equal/custom
// 之间再选一次，复用同一份 SPLIT_MODE_OPTIONS 去掉 onlyMe 那一档。
const SPLIT_SUB_MODE_OPTIONS = SPLIT_MODE_OPTIONS.filter((opt) => opt.value !== 'onlyMe');

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

interface PaymentMethodOption {
  id: string;
  label: string;
}

export function ExpenseForm({
  tripId,
  baseCurrency,
  myParticipantId,
  participants,
  paymentMethods,
  initialExpense,
}: {
  tripId: string;
  baseCurrency: string;
  myParticipantId: string;
  participants: Participant[];
  paymentMethods: PaymentMethodOption[];
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

  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState<string | null>(
    initialExpense?.paymentMethodId ?? null
  );

  // fix(2026-09-14 ui-auditor 第二轮复验抓到的真 bug)：新建消费时默认值原本是 'equal'，
  // 但开关的 aria-checked 判定是 splitMode !== 'onlyMe'，'equal' 不等于 'onlyMe'，导致
  // 开关一进页面就是"开"的，跟 Artifact 默认关闭态（只有自己一个人的消费，不用问）对不上。
  // 编辑已有消费时 initialSplitState 会覆盖这个默认值，行为不受影响。
  const [splitMode, setSplitMode] = useState<SplitMode>(initialSplitState?.splitMode ?? 'onlyMe');
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
    // fix(2026-09-13 Artifact Version 10 落地，第四轮拍板)："这笔要跟别人分摊"这个开关
    // 关闭（= 选中「仅我自己」）时默认代垫人就是自己，不用问；打开（平分/自定义分摊）
    // 才需要问"谁垫的钱"——同行人分摊的场景才可能是别人代垫。选回"仅我自己"时把代垫人
    // 强制归位到自己，避免"之前手动选了别人当代垫人，又切回仅我自己"这种不一致状态残留。
    if (mode === 'onlyMe') {
      setPayerParticipantId(myParticipantId);
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
            onChange={(e) => setCurrency(e.target.value)}
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

      {/* fix(2026-09-14 Artifact Version 10 走查补做)：字段顺序改成 Artifact 骨架——
          金额+币种 → 商家名称 → 日期 → 分类 → 支付方式 → 备注 → 分摊区块（最下面）。
          「商家名称」「日期」两个字段位置往上挪，「分类」也往上挪到「支付方式」前面。 */}
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

      {/* fix(2026-09-14 第四轮走查，Remy 本人明确要求"都要做")：这里原本是一张带"比价"
          按钮的卡片（点了拉 /api/trips/{tripId}/fx-recommendation 算哪张卡最划算），
          跟 Artifact 画的纯朴素下拉不一样。Remy 原话是把"记一笔消费"这里简化成 Artifact
          这种下拉就好，比价功能本身有真实价值，不能删，但不能留在这个位置——这轮先从这里
          搬走，没有接到新地方（"搁置想清楚放哪"），底层 lib/domain/fx-recommendation +
          /api/trips/[tripId]/fx-recommendation 路由 + FxCompareList 组件原样保留没删，
          只是这张表单不再引用。
          照抄的是币种字段（上面 357 行左右）同一套原生 select 模式，不新发明下拉组件——
          Artifact 的 .dd-fake 只是静态原型没有真下拉逻辑。
          fix(2026-09-15 补齐架构缺口)：这里列出来的原本是"我名下全部支付方式"，跟
          Artifact 明确拍板的"本行程启用的支付方式"（见 payment-methods-manager.tsx 顶部
          注释）不一样。schema 加了 trip_payment_method_enabled 关联表之后，调用方
          （expenses/new、expenses/[expenseId]/edit 两个 page.tsx）已经把 `paymentMethods`
          这个 prop 过滤成"这趟行程勾了启用的那几个"再传进来，这个组件本身不用重新判断
          谁启用谁没启用，照抄 Artifact 原文改成这句提示就好。 */}
      <div className="flex flex-col gap-1">
        <label className="field-label" htmlFor="payment-method">
          支付方式
        </label>
        {paymentMethods.length > 0 ? (
          <select
            id="payment-method"
            value={selectedPaymentMethodId ?? ''}
            onChange={(e) => setSelectedPaymentMethodId(e.target.value || null)}
            className="field-input"
          >
            <option value="">不指定</option>
            {paymentMethods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-[10px] text-muted">
            这趟行程还没有启用的支付方式，先去{' '}
            <Link href={`/trips/${tripId}/payment-methods`} className="tap-link">
              支付方式设置
            </Link>{' '}
            配一个、记得勾选「本行程启用」。
          </p>
        )}
        {paymentMethods.length > 0 && (
          <span className="text-[10px] text-muted">
            只列出这个行程「支付方式」页面里勾选启用的那几张卡/钱包，不是全部支付方式。
          </span>
        )}
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

      {/* fix(2026-09-14 Artifact Version 10 走查补做)：这屏的分摊控件按 Version 10 应该
          是一个开关（.switch，"跟其他人 split 这笔"），之前做成了跟行程主页"快速记账"
          一样的三段式按钮（.seg3）——那是另一个屏幕该用的组件，这里用错了。改成开关：
          关掉＝onlyMe，这块内容完全收起，不再留一个"若隐若现"的"谁代垫的"标签；打开才
          展开"谁垫的钱？"统一区块，里面先选 平分/自定义分摊，紧跟着"谁代垫的"下拉，
          "自定义分摊"详情编辑器位置不变。分摊名单读的是真实 participants prop，
          跟"邀请管理"页参与者数据同步（那边加了新参与者，这里下次进来就读得到）。
          底层数据模型（splitMode: onlyMe/equal/custom）完全没动，只是 UI 呈现变了，
          handleSubmit/handleSelectSplitMode 这些既有逻辑原样复用。 */}
      <div className="flex flex-col gap-2 rounded-xl border border-sand bg-paper p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="field-label">跟其他人 split 这笔</span>
            <span className="text-[10px] text-muted">
              关掉开关＝这笔账是自己的消费，不是垫钱；打开才需要决定谁垫的钱、跟谁分——分摊名单会跟着「邀请管理」页面的参与者实时同步。
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={splitMode !== 'onlyMe'}
            aria-label="跟其他人 split 这笔"
            onClick={() => handleSelectSplitMode(splitMode === 'onlyMe' ? 'equal' : 'onlyMe')}
            className={`relative inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-full transition-colors ${
              splitMode !== 'onlyMe' ? 'bg-accent-700' : 'bg-sand'
            }`}
          >
            <span
              className={`inline-block h-[14px] w-[14px] transform rounded-full bg-white shadow transition-transform ${
                splitMode !== 'onlyMe' ? 'translate-x-[16px]' : 'translate-x-[2px]'
              }`}
            />
          </button>
        </div>

        {splitMode !== 'onlyMe' && (
          <div className="flex flex-col gap-2 border-t border-sand pt-2">
            <span className="field-label">谁垫的钱？</span>
            <div className="flex flex-wrap gap-1.5">
              {SPLIT_SUB_MODE_OPTIONS.map((opt) => (
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
                        className="field-input w-28 font-serif tabular-nums"
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
                  <span className={`text-[10px] ${splitMismatch ? 'text-coral' : 'text-ok'}`}>
                    已分配{' '}
                    <span className="font-serif tabular-nums">{formatMoney(splitCentsTotal, currency)}</span> / 共{' '}
                    <span className="font-serif tabular-nums">{formatMoney(amountCentsTotal, currency)}</span>
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
        <Link href={`/trips/${tripId}`} className="tap-link text-[12.5px] text-muted">
          取消
        </Link>
      </div>
    </form>
  );
}
