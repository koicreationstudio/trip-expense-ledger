'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { COMMON_CURRENCIES } from '@/lib/currencies';
import { COMMON_CATEGORIES } from '@/lib/domain/categories';
import { equalSplit, rescaleSplitToBaseCurrency } from '@/lib/domain/split';
import type { SplitShare } from '@/lib/domain/split';
import { yuanToCents, centsToYuan, formatMoney } from '@/lib/money';
import { CategoryCombobox } from '@/components/category-combobox';

interface Participant {
  id: string;
  displayName: string;
}

const API_ERROR_LABEL: Record<string, string> = {
  fx_rate_required: '币种不是本位币，要填汇率才能提交',
  invalid_payer: '代垫人不在这个行程里',
  duplicate_split_participant: '分摊名单里有人重复了',
  invalid_split_participant: '分摊名单里有人不在这个行程里',
  splits_do_not_sum_to_total: '自定义分摊金额总和要等于消费总金额',
};

type SplitMode = 'onlyMe' | 'equal' | 'custom';

const SPLIT_MODE_OPTIONS: { value: SplitMode; label: string }[] = [
  { value: 'onlyMe', label: '仅我自己' },
  { value: 'equal', label: '平分' },
  { value: 'custom', label: '自定义分摊' },
];

/**
 * 「我的钱包」区块里的行内快速记账：只填金额/分类/币种（+ 非本位币时的汇率）就能提交，
 * 走的还是完整记账表单同一个 POST /api/trips/{tripId}/expenses 接口（复用同一套
 * 校验/分摊/汇率逻辑），不是另起一套简化 API。代垫人固定为「我自己」——这是这个组件
 * 的产品判断（quickadd 是「我的钱包」个人视角区块，不在这里暴露选人），没有对不上
 * 就别改，改法应该是先跟 Remy 确认。
 *
 * 分摊三档（2026-09-12 走查反馈：之前只有"平分/自定义"两档，纯粹自己的消费也被
 * 强制分给同行者）——「仅我自己」/「平分」/「自定义分摊」。「仅我自己」不新造数据
 * 结构，复用跟自定义分摊一样的 SplitShare[]，只是参与者收窄成自己一个人、份额是
 * 全额（等价于 equalSplit(amountBaseCurrency, [myParticipantId])，equalSplit 单人
 * 时本来就是全额，split.test.ts 已经覆盖这个行为）。「平分」不传 splits，交给后端
 * equalSplit 自动分。「自定义分摊」点开才展出逐人勾选 + 金额输入。
 */
export function QuickAddExpense({
  tripId,
  baseCurrency,
  myParticipantId,
  participants,
}: {
  tripId: string;
  baseCurrency: string;
  myParticipantId: string;
  participants: Participant[];
}) {
  const router = useRouter();

  const [amountYuan, setAmountYuan] = useState('');
  const [category, setCategory] = useState('');
  const [currency, setCurrency] = useState(baseCurrency);
  const [fxRateUsed, setFxRateUsed] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [splitMode, setSplitMode] = useState<SplitMode>('equal');
  const [splitIncluded, setSplitIncluded] = useState<Record<string, boolean>>(
    Object.fromEntries(participants.map((p) => [p.id, true]))
  );
  const [splitAmounts, setSplitAmounts] = useState<Record<string, string>>({});

  const needsManualFxRate = currency !== baseCurrency;
  const currencyOptions = Array.from(new Set([baseCurrency, ...COMMON_CURRENCIES]));

  const amountCentsTotal = yuanToCents(Number(amountYuan) || 0);
  const includedParticipants = participants.filter((p) => splitIncluded[p.id] ?? true);
  const splitCentsTotal = includedParticipants.reduce(
    (sum, p) => sum + yuanToCents(Number(splitAmounts[p.id]) || 0),
    0
  );
  const splitMismatch = splitMode === 'custom' && splitCentsTotal !== amountCentsTotal;

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

  function handleSelectSplitMode(mode: SplitMode) {
    setSplitMode(mode);
    // 第一次点开自定义分摊且还没填过分摊金额时，先按当前金额平均分好，免得一打开就要
    // 面对空白/总和为 0 的红字——用户从这份等分基准上再调，比从零开始填更快。
    if (mode === 'custom' && Object.keys(splitAmounts).length === 0 && amountCentsTotal > 0 && includedParticipants.length > 0) {
      handleEqualizeSplit();
    }
  }

  function resetForm() {
    setAmountYuan('');
    setCategory('');
    setCurrency(baseCurrency);
    setFxRateUsed('');
    setSplitMode('equal');
    setSplitIncluded(Object.fromEntries(participants.map((p) => [p.id, true])));
    setSplitAmounts({});
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const amount = Number(amountYuan);
    if (!amount || amount <= 0) {
      setError('金额要大于 0');
      return;
    }
    if (!category.trim()) {
      setError('分类不能空着');
      return;
    }
    if (needsManualFxRate && !fxRateUsed) {
      setError(`币种不是本位币 ${baseCurrency}，要填汇率（1 ${currency} = 多少 ${baseCurrency}）`);
      return;
    }

    const amountCents = yuanToCents(amount);
    const amountBaseCurrency = needsManualFxRate ? Math.round(amountCents * Number(fxRateUsed)) : amountCents;

    let splits: SplitShare[] | undefined;
    if (splitMode === 'onlyMe') {
      splits = equalSplit(amountBaseCurrency, [myParticipantId]);
    } else if (splitMode === 'custom') {
      if (includedParticipants.length === 0) {
        setError('自定义分摊至少要选一个人');
        return;
      }
      const nativeShares = includedParticipants.map((p) => ({
        participantId: p.id,
        amountNativeCents: yuanToCents(Number(splitAmounts[p.id]) || 0),
      }));
      const nativeSum = nativeShares.reduce((sum, s) => sum + s.amountNativeCents, 0);
      if (nativeSum !== amountCents) {
        setError('自定义分摊金额总和要等于消费总金额');
        return;
      }
      splits = rescaleSplitToBaseCurrency(nativeShares, amountBaseCurrency);
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/expenses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          payerParticipantId: myParticipantId,
          amount: amountCents,
          currency,
          fxRateUsed: needsManualFxRate ? Number(fxRateUsed) : undefined,
          category: category.trim(),
          expenseDate: new Date().toISOString(),
          splits,
        }),
      });

      if (!res.ok) {
        const body = await (res.json() as Promise<any>).catch(() => null);
        setError((body?.error && API_ERROR_LABEL[body.error]) ?? '提交失败，检查一下表单内容');
        return;
      }

      resetForm();
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // fix(2026-09-15 第十轮)：外层背景/圆角/内边距挪到父级 wallet-card.tsx 的独立
    // <section>（现在是真正的独立卡片，不是嵌在钱包卡里的一块半透明叠加区），这里
    // 只保留内部纵向排列；.cap 字号对齐 Artifact `.quickadd .cap{font-size:10px}`。
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-hero-label">⚡ 快速记账</span>
      {/* noValidate: 金额输入框带 min="0.01" 这类 HTML5 constraint，浏览器会在
          onSubmit 的 preventDefault 真正执行前抢先用 reportValidity() 弹出原生
          英文提示气泡（比如"填 0"这个具体数值会被 min 拦截，只有"留空"才轮得到
          下面这段 JS 校验跑）。关掉浏览器原生校验，把判断权完整交给这段已经写好
          的中文错误提示，两条路径（留空/填0）都要走到同一套中文文案。 */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-1.5" noValidate>
        {/* fix(2026-09-14 Artifact Version 10 走查补做)：字段左右顺序改成 Artifact 的
            "分类→币种→金额"，纯粹换位置，三个字段各自的交互（分类走 CategoryCombobox
            下拉、币种走 select）都不动。 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <CategoryCombobox
            value={category}
            onChange={setCategory}
            options={COMMON_CATEGORIES}
            placeholder="分类"
            ariaLabel="分类"
            inputClassName="field-input-dark min-w-[64px] flex-1"
          />
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            aria-label="币种"
            className="field-input-dark shrink-0"
          >
            {currencyOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amountYuan}
            onChange={(e) => setAmountYuan(e.target.value)}
            placeholder="金额"
            aria-label="金额"
            className="field-input-dark w-[74px] font-serif tabular-nums"
          />
          <button
            type="submit"
            disabled={submitting || splitMismatch}
            className="inline-flex min-h-[28px] shrink-0 items-center justify-center rounded-full bg-white px-3 text-[11px] font-medium text-ink transition-colors hover:bg-white/90 disabled:opacity-50"
          >
            {submitting ? '记中…' : '记'}
          </button>
        </div>

        {needsManualFxRate && (
          <input
            type="number"
            min="0"
            step="0.0001"
            value={fxRateUsed}
            onChange={(e) => setFxRateUsed(e.target.value)}
            placeholder={`汇率（1 ${currency} = 多少 ${baseCurrency}）`}
            aria-label="汇率"
            className="field-input-dark"
          />
        )}

        {/* fix(2026-09-16 第十七轮，Remy 截图坐实的真差异)：Artifact `.seg3` 是一条暖米黄色
            (--cream) 轨道，选中项是深色实底(--ink)白字嵌在轨道里，未选中项是轨道底色上的
            纯深色文字（不是单独一颗颜色反过来的白底黑字）——之前这里选中态是"白底黑字"，
            未选中态是"半透明白底白字"，颜色整个反了，而且没有共享的米黄色轨道容器，
            三颗按钮看起来像各自独立的小方块。这次照 `.seg3`/`.seg3 button`/`.seg3 button.on`
            三条规则逐值改，不是凭印象调深浅。 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[9.5px] text-hero-label">分摊</span>
          <div className="flex flex-1 gap-1 rounded-full bg-cream p-[3px]">
            {SPLIT_MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSelectSplitMode(opt.value)}
                aria-pressed={splitMode === opt.value}
                className={`inline-flex min-h-[22px] flex-1 shrink-0 items-center justify-center whitespace-nowrap rounded-full px-2 text-[9.5px] font-medium transition-colors ${
                  splitMode === opt.value ? 'bg-ink text-white' : 'text-ink/80 hover:text-ink'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {splitMode === 'custom' && (
          <div className="flex flex-col gap-1 rounded-[8px] bg-white/[.05] p-1.5">
            {participants.map((p) => (
              <div key={p.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={splitIncluded[p.id] ?? true}
                  onChange={(e) => setSplitIncluded((prev) => ({ ...prev, [p.id]: e.target.checked }))}
                  aria-label={`分摊包含 ${p.displayName}`}
                />
                <span className="w-14 shrink-0 truncate text-[10.5px] text-white">{p.displayName}</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  disabled={!(splitIncluded[p.id] ?? true)}
                  value={splitAmounts[p.id] ?? ''}
                  onChange={(e) => setSplitAmounts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  placeholder="0.00"
                  aria-label={`${p.displayName} 分摊金额`}
                  className="field-input-dark w-20 font-serif tabular-nums"
                />
                <span className="text-[9px] text-hero-label">{currency}</span>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <button
                type="button"
                onClick={handleEqualizeSplit}
                className="inline-flex min-h-[24px] shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-white/[.1] px-2 text-[9.5px] font-medium text-white"
              >
                平分给已勾选的人
              </button>
              <span className={`text-[9.5px] ${splitMismatch ? 'text-negative-dk' : 'text-positive-dk'}`}>
                已分配{' '}
                <span className="font-serif tabular-nums">{formatMoney(splitCentsTotal, currency)}</span> /{' '}
                <span className="font-serif tabular-nums">{formatMoney(amountCentsTotal, currency)}</span>
              </span>
            </div>
          </div>
        )}

        {/* 深色卡里没有专门的「错误态」token，借用财务语义色的浅色变体 negative-dk
            （本来配对深底"该付"金额用），在这块深色底上刚好够亮好读，不新造颜色。 */}
        {error && <p className="text-[10px] text-negative-dk">{error}</p>}
      </form>
    </div>
  );
}
