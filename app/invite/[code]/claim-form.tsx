'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SelectDropdown } from '@/components/select-dropdown';

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
        {/* fix(2026-09-24，第四十二轮，横扫"换 session 再导航"这一类场景时顺带查到的
            同款缺口)：认领身份成功那一刻服务端已经铸了新 tel_session（POST
            /api/invite/[code]/claim），但这里点"现在就去记账"只 push 没有 refresh，
            跟 my-trips.tsx handleOpen 是完全同一类问题（详见那边的注释）。这里补齐
            router.refresh()，不是新问题，是同一个 class 在另一个入口的实例。 */}
        <button
          type="button"
          onClick={() => {
            router.push(`/trips/${tripId}`);
            router.refresh();
          }}
          className="btn-primary"
        >
          现在就去记账
        </button>
      </div>
    );
  }

  // fix(2026-09-24 第六十四轮)：真正的 method/action + 下面的隐藏 participantId，
  // React 水合之前点「认领这个身份」也能原生提交（路由认得表单提交，成功 303 进行程页）；
  // 水合之后 handleSubmit 里 preventDefault 照旧走 fetch。背景见 app/my-trips.tsx TripCard 注释。
  return (
    <form method="post" action={`/api/invite/${code}/claim`} onSubmit={handleSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="participantId" value={participantId} />
      <div className="flex flex-col gap-1">
        <label className="field-label" htmlFor="participant">
          我是
        </label>
        <SelectDropdown
          id="participant"
          value={participantId}
          onChange={setParticipantId}
          triggerClassName="field-input w-full"
          options={unclaimedParticipants.map((p) => ({ value: p.id, label: p.displayName }))}
        />
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
