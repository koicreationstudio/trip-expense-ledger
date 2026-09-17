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
import { SelectDropdown } from '@/components/select-dropdown';

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
  excludeFromSplit: boolean;
}

// fix(2026-09-16)：机票/宝石这两个分类默认"不计入分摊"（业务差旅成本，不该分给
// 同行人），其它分类默认照旧"计入分摊"。这里按 COMMON_CATEGORIES 里的确切文案
// 精确匹配（含 emoji 前缀），不是"分类包含'机票'两个字"这种模糊匹配——CategoryCombobox
// 允许自由输入，用户手打的分类不会命中这两个字符串，就落回默认 false，不强加。
const AUTO_EXCLUDE_CATEGORIES = new Set<string>(['✈️ 机票', '💎 宝石']);

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
  // fix(2026-09-17 第十九轮)：Artifact 这一屏的分类字段是预填了"🍜 餐饮"的选择器
  // （`<div class="dd-fake"><span id="exp-cat-label">🍜 餐饮</span>`），新建消费时
  // 默认给第一个候选分类，不是空字段——之前留空导致独立 ui-auditor 盲测看到的是一个
  // "占位符'例如：餐饮'的纯文本框"，看起来完全不像下拉选择器。这里只改默认值，
  // CategoryCombobox 本身"可以自由打字"的能力保留（2026-09-12 因 iOS Safari datalist
  // 渲染缺陷换成这个组件，见 category-combobox.tsx 顶部注释，是刻意保留的真实能力，
  // 不是要退化成方案demo那种纯选择器，只是外观上要看得出"这是可以点开选的下拉"）。
  const [category, setCategory] = useState(initialExpense?.category ?? COMMON_CATEGORIES[0]);
  const [merchant, setMerchant] = useState(initialExpense?.merchant ?? '');
  const [expenseDate, setExpenseDate] = useState(
    initialExpense ? initialExpense.expenseDate.slice(0, 10) : new Date().toISOString().slice(0, 10)
  );
  const [note, setNote] = useState(initialExpense?.note ?? '');
  // fix(2026-09-16)："这笔不计入分摊"开关。新建时按初始分类自动给个默认值
  // （机票/宝石预设 true），一旦用户自己手动点过这个勾选框（excludeFromSplitTouched），
  // 之后再切换分类就不再覆盖用户的选择——只是"帮用户省一次手动勾选"，不是写死的强规则。
  const [excludeFromSplit, setExcludeFromSplit] = useState(
    initialExpense?.excludeFromSplit ?? AUTO_EXCLUDE_CATEGORIES.has(initialExpense?.category ?? '')
  );
  const [excludeFromSplitTouched, setExcludeFromSplitTouched] = useState(false);

  function handleCategoryChange(value: string) {
    setCategory(value);
    if (!excludeFromSplitTouched) {
      setExcludeFromSplit(AUTO_EXCLUDE_CATEGORIES.has(value));
    }
  }
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
    } else {
      // fix(2026-09-15 round10 真实结构性缺口)：「平分」之前完全没有显式传 splits，
      // POST 时交给后端默认值（app/api/trips/[tripId]/expenses/route.ts 第 64 行），
      // 但那个默认值是「行程全部参与者平分」，压根不知道「跟谁分？」这组新增的
      // 勾选——选了只跟其中几个人分、点了平分，实际却悄悄分给了全部人，是那种
      // 「代码看起来加了勾选框，但真实数据下选了也没用」的假功能。这里改成一律
      // 显式按 includedParticipants 传 splits（创建和编辑都一样），不再依赖后端
      // 默认值，「跟谁分？」勾选真的会决定平分的分母。
      if (includedParticipants.length === 0) {
        setError('平分至少要选一个人参与');
        return;
      }
      splits = equalSplit(amountBaseCurrency, includedParticipants.map((p) => p.id));
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
          excludeFromSplit,
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
          <SelectDropdown
            id="currency"
            value={currency}
            onChange={setCurrency}
            triggerClassName="field-input w-full"
            options={Array.from(new Set([baseCurrency, ...COMMON_CURRENCIES])).map((c) => ({
              value: c,
              label: c,
            }))}
          />
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
          onChange={handleCategoryChange}
          options={COMMON_CATEGORIES}
          placeholder="例如：餐饮"
          inputClassName="field-input"
          containerClassName="w-full"
          showChevron
        />
      </div>

      {/* fix(2026-09-16)："不计入分摊"开关——机票/宝石这类差旅业务成本默认勾选，
          不该分给同行人；其它分类默认不勾。跟"跟其他人 split 这笔"是两回事：那个
          开关决定"这笔实际怎么分给谁"，这个开关只决定"这笔算不算进行程主页 Hero
          卡'我承担'那个主数字"，两者互不影响，这笔即使勾了这里，下面照样可以正常
          设置 splits（真实语义详见 PENDING-DECISIONS，这是待 Remy 确认的理解）。 */}
      <div className="flex items-start gap-2 rounded-xl border border-sand bg-paper p-3">
        <input
          id="exclude-from-split"
          type="checkbox"
          checked={excludeFromSplit}
          onChange={(e) => {
            setExcludeFromSplit(e.target.checked);
            setExcludeFromSplitTouched(true);
          }}
          className="mt-[3px] h-4 w-4 shrink-0 accent-accent-700"
        />
        <label htmlFor="exclude-from-split" className="flex flex-col gap-0.5">
          <span className="field-label">这笔不计入跟同行人的分摊总额</span>
          <span className="text-[10px] text-muted">
            业务/个人成本（比如机票、宝石采购），照常记账，只是不算进行程主页「我承担」的合计数字里，下面分摊设置不受影响。选了「✈️ 机票」或「💎 宝石」分类会自动帮你勾上，你也可以手动改。
          </span>
        </label>
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
          <SelectDropdown
            id="payment-method"
            value={selectedPaymentMethodId ?? ''}
            onChange={(next) => setSelectedPaymentMethodId(next || null)}
            triggerClassName="field-input w-full"
            options={[
              { value: '', label: '不指定' },
              ...paymentMethods.map((m) => ({ value: m.id, label: m.label })),
            ]}
          />
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
      {/* fix(2026-09-16 第十七轮，Remy 反馈"不只首页，其它屏也一样"后逐屏核对发现)：
          Artifact 这一整块只有开关行(.split-toggle-row)本身没有卡片外壳，展开的
          内容才是一张 `.split-panel{background:var(--cream)}` 米黄卡片——之前这里
          把开关行跟展开内容一起塞进同一个 `border-sand bg-paper` 灰白盒子里，跟
          "快速记账"卡那个 seg3 一样，展开内容里的按钮组也是"选中态用 accent-700
          蓝黑色"，不是 spec 里"未选中白底、选中深色实底"这套配色。这次把外层灰白
          盒子拿掉（开关行本身不需要卡片包装），展开内容改成真正的 `.split-panel`
          米黄卡片，`.btns button`/`.btns button.on` 逐值照抄。 */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="field-label">跟其他人 split 这笔</span>
            <span className="text-[10px] text-muted">
              关掉开关 = 这笔就是自己的消费，不问是谁垫的；打开才需要决定跟谁分、谁先垫钱。跟谁分的名单现在会跟着「邀请管理」页面的参与者实时同步（这版已经接起来了）：邀请管理那边加了新参与者，这里下次进来会读到最新名单。
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
          <div className="flex flex-col gap-[7px] rounded-[12px] bg-cream p-2">
            {/* fix(2026-09-15 round10)：Artifact 这个开关打开后是「跟谁分？→谁垫的钱？→
                怎么分？」三组独立问题，「跟谁分？」是这次新补的一组——之前只有「怎么分？」
                (平分/自定义) 一组，平分时到底跟谁分是隐性的（后端默认全体参与者），
                这里补成一排可勾选的参与者 chip，跟自定义分摊共用同一份 splitIncluded
                state，勾选结果对平分/自定义都生效。 */}
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-semibold text-gold-dk">跟谁分？</span>
              <div className="flex flex-wrap gap-1.5">
                {participants.map((p) => {
                  const included = splitIncluded[p.id] ?? true;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSplitIncluded((prev) => ({ ...prev, [p.id]: !included }))}
                      aria-pressed={included}
                      className={
                        included
                          ? 'inline-flex min-h-[26px] shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-ink px-[10px] text-[10px] font-medium text-white transition-colors'
                          : 'inline-flex min-h-[26px] shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-white px-[10px] text-[10px] font-medium text-ink transition-colors hover:opacity-80'
                      }
                    >
                      {p.displayName}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-gold-dk" htmlFor="payer">
                谁垫的钱？
              </label>
              <SelectDropdown
                id="payer"
                value={payerParticipantId}
                onChange={setPayerParticipantId}
                triggerClassName="w-full rounded-lg border border-sand bg-white px-[7px] py-[5px] text-[10px] text-ink focus:border-accent-700 focus:outline-none"
                options={participants.map((p) => ({
                  value: p.id,
                  label: p.id === myParticipantId ? `${p.displayName}（我）` : p.displayName,
                }))}
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-semibold text-gold-dk">怎么分？</span>
              <div className="flex flex-wrap gap-1.5">
                {SPLIT_SUB_MODE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleSelectSplitMode(opt.value)}
                    aria-pressed={splitMode === opt.value}
                    className={
                      splitMode === opt.value
                        ? 'inline-flex min-h-[26px] shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-ink px-[10px] text-[10px] font-medium text-white transition-colors'
                        : 'inline-flex min-h-[26px] shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-white px-[10px] text-[10px] font-medium text-ink transition-colors hover:opacity-80'
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {splitMode === 'equal' && (
                <p className="text-[10px] text-gold-dk">按上面「跟谁分？」勾选的人平均分摊这笔消费。</p>
              )}
            </div>

            {splitMode === 'custom' && (
              <div className="flex flex-col gap-2">
                {/* fix(2026-09-15 round10)：「跟谁分？」那组 chip 已经决定了包含谁，这里
                    不再重复一份 checkbox（两处各管一份 splitIncluded 容易勾出不一致的
                    状态）。恰好 2 人时加一层「填一个、另一个自动算」联动（Artifact 明确
                    点名的场景），3 人以上维持各自手动填 + 下面的「平均分给已勾选的人」
                    按钮兜底。 */}
                <div className="flex flex-col gap-1">
                  {includedParticipants.map((p) => (
                    <div key={p.id} className="flex items-center gap-2">
                      <span className="w-24 shrink-0 text-[12.5px]">{p.displayName}</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={splitAmounts[p.id] ?? ''}
                        onChange={(e) => {
                          const nextVal = e.target.value;
                          setSplitAmounts((prev) => {
                            const next = { ...prev, [p.id]: nextVal };
                            if (includedParticipants.length === 2) {
                              const other = includedParticipants.find((o) => o.id !== p.id);
                              if (other) {
                                const remainderCents = amountCentsTotal - yuanToCents(Number(nextVal) || 0);
                                next[other.id] = String(centsToYuan(Math.max(0, remainderCents)));
                              }
                            }
                            return next;
                          });
                        }}
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

      {/* fix(2026-09-17 第十九轮，独立 ui-auditor 盲测坐实)：round17 那句"这个按钮本来就是
          走全站表单主按钮统一规则（跟表单等宽、居中）"核实错了——Artifact 这一屏的原文
          注释其实写的正是"跟表单等宽、居中"这句话本身（`.big-cta{width:100%}`），但当时
          没有真的截图比对，线上实际是 .btn-primary 这个紧凑胶囊+旁边贴"取消"文字链接，
          跟表单宽度对不上。这次改用 .big-cta（全宽，跟输入框同宽），"取消"降级挪到
          按钮下方的次要位置，不再跟主按钮平起平坐抢视觉重量。 */}
      <div className="flex flex-col items-center gap-2">
        <button
          type="submit"
          disabled={submitting || splitMismatch}
          className="big-cta"
        >
          {submitting ? '保存中…' : isEdit ? '保存修改' : '记这笔账'}
        </button>
        <Link href={`/trips/${tripId}`} className="tap-link text-[11px] text-muted">
          取消
        </Link>
      </div>
    </form>
  );
}
