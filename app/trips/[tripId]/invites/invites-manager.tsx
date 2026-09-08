'use client';

import { useEffect, useState } from 'react';

interface Invite {
  id: string;
  code: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

interface Participant {
  id: string;
  displayName: string;
  isOwner: boolean;
  claimed: boolean;
}

export function InvitesManager({ tripId }: { tripId: string }) {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [participants, setParticipants] = useState<Participant[] | null>(null);
  const [expiresInDays, setExpiresInDays] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  async function loadAll() {
    const [tripRes, invitesRes] = await Promise.all([
      fetch(`/api/trips/${tripId}`),
      fetch(`/api/trips/${tripId}/invites`),
    ]);
    if (tripRes.ok) {
      const data = (await tripRes.json()) as any;
      setParticipants(data.participants);
    }
    if (invitesRes.ok) {
      const data = (await invitesRes.json()) as any;
      setInvites(data.invites);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreateInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/invites`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(expiresInDays ? { expiresInDays: Number(expiresInDays) } : {}),
      });
      if (!res.ok) {
        setError('生成邀请链接失败');
        return;
      }
      setExpiresInDays('');
      await loadAll();
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(inviteId: string) {
    if (!confirm('确定要撤销这个邀请链接吗？撤销后这个链接就不能再用来认领了。')) return;
    await fetch(`/api/trips/${tripId}/invites/${inviteId}`, { method: 'DELETE' });
    await loadAll();
  }

  async function handleResetClaim(participantId: string) {
    if (!confirm('确定要重置这个人的认领状态吗？重置后他之前的登录会失效，需要重新用邀请链接认领。')) return;
    await fetch(`/api/trips/${tripId}/participants/${participantId}/reset-claim`, { method: 'POST' });
    await loadAll();
  }

  function inviteUrl(code: string) {
    return `${window.location.origin}/invite/${code}`;
  }

  async function handleCopy(code: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl(code));
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      // 剪贴板权限拿不到就算了，链接本来就显示在页面上，用户可以自己选中复制
    }
  }


  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-[12.5px] font-semibold text-ink">生成新邀请链接</h2>
        <form onSubmit={handleCreateInvite} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="field-label" htmlFor="expires-in-days">
              有效期（天，留空=不设有效期）
            </label>
            <input
              id="expires-in-days"
              type="number"
              min="1"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              className="field-input w-40"
            />
          </div>
          <button
            type="submit"
            disabled={creating}
            className="btn-primary shrink-0 whitespace-nowrap"
          >
            {creating ? '生成中…' : '生成邀请链接'}
          </button>
        </form>
        {error && <p className="text-sm text-coral">{error}</p>}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[12.5px] font-semibold text-ink">现有邀请链接</h2>
        {invites === null ? (
          <p className="text-xs text-muted">载入中…</p>
        ) : invites.length === 0 ? (
          <p className="text-xs text-muted">还没生成过邀请链接。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {invites.map((invite) => {
              const isRevoked = invite.revokedAt !== null;
              const isExpired = invite.expiresAt !== null && new Date(invite.expiresAt).getTime() < Date.now();
              return (
                <li key={invite.id} className="flex flex-col gap-1 rounded-xl border border-sand bg-[#EDE8DA]/35 px-[9px] py-[5px] text-sm">
                  <code className="break-all text-xs text-muted">{inviteUrl(invite.code)}</code>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                    {isRevoked || isExpired ? (
                      <span>
                        {isRevoked ? '已撤销' : '已过期'}
                        {invite.expiresAt && !isRevoked ? ` · 到期 ${new Date(invite.expiresAt).toLocaleDateString()}` : ''}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <span className="rounded-full bg-live-bg px-[9px] py-[3px] text-[9.5px] font-medium text-live">有效</span>
                        {invite.expiresAt && (
                          <span>{`到期 ${new Date(invite.expiresAt).toLocaleDateString()}`}</span>
                        )}
                      </span>
                    )}
                    <button type="button" onClick={() => handleCopy(invite.code)} className="tap-link">
                      {copiedCode === invite.code ? '已复制' : '复制链接'}
                    </button>
                    {!isRevoked && (
                      <button type="button" onClick={() => handleRevoke(invite.id)} className="tap-link text-coral">
                        撤销
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[12.5px] font-semibold text-ink">参与者认领状态</h2>
        <p className="text-xs text-muted">认领错人、换手机号了，可以把某个人重置回未认领状态，让他重新用邀请链接认领。</p>
        {participants === null ? (
          <p className="text-xs text-muted">载入中…</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {participants.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-xl border border-sand bg-[#EDE8DA]/35 px-[9px] py-[5px]"
              >
                <span className="text-[12.5px]">
                  {p.displayName}
                  {p.isOwner && <span className="ml-2 text-[10px] text-muted">创建者</span>}
                  <span
                    className={`ml-2 inline-flex items-center rounded-full px-[9px] py-[3px] text-[9.5px] font-medium ${
                      p.claimed ? 'bg-ok-bg text-ok' : 'bg-gold-lt text-gold-dk'
                    }`}
                  >
                    {p.claimed ? '已认领' : '未认领'}
                  </span>
                </span>
                {p.claimed && !p.isOwner && (
                  <button type="button" onClick={() => handleResetClaim(p.id)} className="tap-link text-sm text-muted">
                    重置认领
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
