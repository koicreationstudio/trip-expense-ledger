'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { COMMON_CURRENCIES } from '@/lib/currencies';

export function NewTripForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [baseCurrency, setBaseCurrency] = useState<string>(COMMON_CURRENCIES[0]);
  // 「同时启用哪些币种」多选 chip：2026-09-13 落地 lifeos-pm 判断的方向（Artifact
  // 自己标注这条还没真正拍板，开放问题②），默认勾选主要币种那一个，用户自己再加。
  // 刻意收敛：这个 state 只喂给提交时的 enabledCurrencies 一个字段，不散播到
  // 记账/钱包等其它地方——万一 Remy 后面说不要这样，删掉这段 state + 对应输入
  // 就能整个回退，不用大改。
  const [enabledCurrencies, setEnabledCurrencies] = useState<string[]>([COMMON_CURRENCIES[0]]);
  const [tripStartDate, setTripStartDate] = useState('');
  const [tripEndDate, setTripEndDate] = useState('');
  const [ownerDisplayName, setOwnerDisplayName] = useState('');
  const [participantNames, setParticipantNames] = useState<string[]>(['']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleCurrency(c: string) {
    setEnabledCurrencies((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  function updateParticipantName(index: number, value: string) {
    setParticipantNames((prev) => prev.map((p, i) => (i === index ? value : p)));
  }

  function removeParticipantRow(index: number) {
    setParticipantNames((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          baseCurrency,
          ownerDisplayName,
          participantNames: participantNames.map((p) => p.trim()).filter((p) => p.length > 0),
          tripStartDate: tripStartDate ? new Date(tripStartDate).toISOString() : undefined,
          tripEndDate: tripEndDate ? new Date(tripEndDate).toISOString() : undefined,
          enabledCurrencies: enabledCurrencies.length > 0 ? enabledCurrencies : undefined,
        }),
      });
      if (!res.ok) {
        setError('创建失败，检查一下行程名称/称呼是不是空的');
        return;
      }
      const data = (await res.json()) as any;
      router.push(`/trips/${data.trip.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <label className="field-label" htmlFor="trip-name">
          行程名称
        </label>
        <input
          id="trip-name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：2026 曼谷出差"
          className="field-input"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="field-label" htmlFor="base-currency">
          本位币（结算/比较用的币种）
        </label>
        <select
          id="base-currency"
          value={baseCurrency}
          onChange={(e) => {
            const next = e.target.value;
            setBaseCurrency(next);
            setEnabledCurrencies((prev) => (prev.includes(next) ? prev : [...prev, next]));
          }}
          className="field-input"
        >
          {COMMON_CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* fix(2026-09-13 落地，开放问题②，未真正拍板)：同时启用哪些币种，多选 chip，
          默认勾选主要币种。 */}
      <div className="flex flex-col gap-1">
        <span className="field-label">同时启用哪些币种（多选）</span>
        <div className="flex flex-wrap gap-1.5">
          {COMMON_CURRENCIES.map((c) => {
            const selected = enabledCurrencies.includes(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggleCurrency(c)}
                aria-pressed={selected}
                className={
                  selected
                    ? 'inline-flex min-h-[26px] shrink-0 items-center justify-center rounded-full bg-accent-700 px-[10px] font-mono text-[10px] font-medium text-white'
                    : 'inline-flex min-h-[26px] shrink-0 items-center justify-center rounded-full border border-sand bg-white px-[10px] font-mono text-[10px] font-medium text-muted'
                }
              >
                {c}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="field-label" htmlFor="trip-start">
            出发日期（可选）
          </label>
          <input
            id="trip-start"
            type="date"
            value={tripStartDate}
            onChange={(e) => setTripStartDate(e.target.value)}
            className="field-input"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="field-label" htmlFor="trip-end">
            返程日期（可选）
          </label>
          <input
            id="trip-end"
            type="date"
            value={tripEndDate}
            onChange={(e) => setTripEndDate(e.target.value)}
            className="field-input"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="field-label" htmlFor="owner-name">
          你的称呼
        </label>
        <input
          id="owner-name"
          required
          value={ownerDisplayName}
          onChange={(e) => setOwnerDisplayName(e.target.value)}
          placeholder="例如：Remy"
          className="field-input"
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="field-label">同行人（先占位，之后发邀请链接给他们各自认领）</span>
        {participantNames.map((p, index) => (
          <div key={index} className="flex gap-2">
            <input
              value={p}
              onChange={(e) => updateParticipantName(index, e.target.value)}
              placeholder="同行人名字"
              className="field-input flex-1"
            />
            <button
              type="button"
              onClick={() => removeParticipantRow(index)}
              className="btn-secondary"
            >
              移除
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setParticipantNames((prev) => [...prev, ''])}
          className="tap-link text-[12.5px] text-muted"
        >
          + 加一位同行人
        </button>
      </div>

      {error && (
        <p className="rounded-xl border border-sand bg-[rgba(164,163,160,.14)] px-[9px] py-[5px] text-[10px] text-coral">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="btn-primary"
      >
        {submitting ? '创建中…' : '创建行程'}
      </button>
    </form>
  );
}
