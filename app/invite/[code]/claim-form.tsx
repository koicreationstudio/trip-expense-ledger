'use client';

import { useState } from 'react';
import Link from 'next/link';
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
  // 认领成功后不强制注册，先展示"要不要顺手注册"的软提示，不点也能直接进去记账。
  const [claimed, setClaimed] = useState(false);

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
      setClaimed(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (claimed) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[10px] text-muted">认领成功，可以直接开始记账了。</p>
        <p className="text-[10px] text-muted">
          要不要顺手开个账号，这样以后能在任何设备找到这个行程？
          {/* fix(2026-09-12 死路走查)：这里原本链到 /login /signup，但 2026-09-09
              第十六轮登录系统换血后这两个路由早就不存在了，是遗留死链接。开号/恢复
              账号唯一的实际入口是 /trips/new 的 ProvisionGate（没账号会先问"新用户
              开号"还是"用身份链接恢复"），两种意图都在那一个页面里覆盖到，直接指过去。 */}
          <Link href="/trips/new" className="tap-link ml-1">
            去开号
          </Link>
        </p>
        <button
          type="button"
          onClick={() => router.push(`/trips/${tripId}`)}
          className="btn-primary"
        >
          现在就去记账
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="field-label" htmlFor="participant">
          我是
        </label>
        <select
          id="participant"
          value={participantId}
          onChange={(e) => setParticipantId(e.target.value)}
          className="field-input"
        >
          {unclaimedParticipants.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
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
        {submitting ? '认领中…' : '认领这个身份'}
      </button>
    </form>
  );
}
