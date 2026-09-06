'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { COMMON_CURRENCIES } from '@/lib/currencies';

export default function NewTripPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [baseCurrency, setBaseCurrency] = useState<string>(COMMON_CURRENCIES[0]);
  const [ownerDisplayName, setOwnerDisplayName] = useState('');
  const [participantNames, setParticipantNames] = useState<string[]>(['']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        }),
      });
      if (!res.ok) {
        setError('创建失败，检查一下行程名称/称呼是不是空的');
        return;
      }
      const data = await res.json();
      router.push(`/trips/${data.trip.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">创建新行程</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="trip-name">
            行程名称
          </label>
          <input
            id="trip-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：2026 曼谷出差"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="base-currency">
            本位币（结算/比较用的币种）
          </label>
          <select
            id="base-currency"
            value={baseCurrency}
            onChange={(e) => setBaseCurrency(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {COMMON_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="owner-name">
            你的称呼
          </label>
          <input
            id="owner-name"
            required
            value={ownerDisplayName}
            onChange={(e) => setOwnerDisplayName(e.target.value)}
            placeholder="例如：Remy"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">同行人（先占位，之后发邀请链接给他们各自认领）</span>
          {participantNames.map((p, index) => (
            <div key={index} className="flex gap-2">
              <input
                value={p}
                onChange={(e) => updateParticipantName(index, e.target.value)}
                placeholder="同行人名字"
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => removeParticipantRow(index)}
                className="rounded-md border border-slate-300 px-3 text-sm text-slate-500 hover:bg-slate-100"
              >
                移除
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setParticipantNames((prev) => [...prev, ''])}
            className="w-fit text-sm text-slate-600 underline"
          >
            + 加一位同行人
          </button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {submitting ? '创建中…' : '创建行程'}
        </button>
      </form>
    </main>
  );
}
