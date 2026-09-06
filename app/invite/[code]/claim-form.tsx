'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface UnclaimedParticipant {
  id: string;
  displayName: string;
}

export function ClaimForm({
  code,
  tripId,
  unclaimedParticipants,
}: {
  code: string;
  tripId: string;
  unclaimedParticipants: UnclaimedParticipant[];
}) {
  const router = useRouter();
  const [participantId, setParticipantId] = useState(unclaimedParticipants[0]?.id ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!participantId) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/invite/${code}/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ participantId }),
      });
      if (!res.ok) {
        setError('认领失败，这个名字可能刚被别人认领了，刷新页面看看还剩谁');
        return;
      }
      router.push(`/trips/${tripId}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="participant">
          我是
        </label>
        <select
          id="participant"
          value={participantId}
          onChange={(e) => setParticipantId(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          {unclaimedParticipants.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {submitting ? '认领中…' : '认领这个身份'}
      </button>
    </form>
  );
}
