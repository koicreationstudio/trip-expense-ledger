'use client';

import { useEffect, useState } from 'react';
import { Avatar } from '@/components/avatar';
import { ConfirmDialog } from '@/components/confirm-dialog';

interface Invite {
  id: string;
  code: string;
  inviteeName: string | null;
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
  const [inviteeName, setInviteeName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  // fix(2026-09-17 第二十一轮，功能性QA发现，跟 account-identity-link.tsx 同一处
  // 静默失败问题)：剪贴板权限拿不到时按钮完全没反应，用户分不清"复制成功"还是
  // "点击没反应"。
  const [copyFailedCode, setCopyFailedCode] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ type: 'revoke' | 'reset'; id: string } | null>(null);

  // 屏⑥"直接添加参与者"（2026-09-13 落地第四轮拍板）：纯姓名，没有登录方式。
  const [newParticipantName, setNewParticipantName] = useState('');
  const [addingParticipant, setAddingParticipant] = useState(false);
  const [addParticipantError, setAddParticipantError] = useState<string | null>(null);
  // fix(2026-09-14 Artifact Version 10 走查补做)：Artifact 里"直接添加参与者"是一行
  // 文字链接，点开才展开这个小表单——之前做成了常驻的一整块 section，比 Artifact 重。
  const [addParticipantOpen, setAddParticipantOpen] = useState(false);
  // fix(2026-09-14 第四轮走查)：Artifact 这屏"生成新邀请链接"也是同一个模式——一颗
  // "＋ 生成新邀请"按钮，点开才展开"对方名字/有效期"这个表单，之前这里是常驻展开的，
  // 没跟"直接添加参与者"那半边统一。
  const [genInviteOpen, setGenInviteOpen] = useState(false);

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
        body: JSON.stringify({
          ...(expiresInDays ? { expiresInDays: Number(expiresInDays) } : {}),
          ...(inviteeName.trim() ? { inviteeName: inviteeName.trim() } : {}),
        }),
      });
      if (!res.ok) {
        setError('生成邀请链接失败');
        return;
      }
      setExpiresInDays('');
      setInviteeName('');
      await loadAll();
    } finally {
      setCreating(false);
    }
  }

  async function handleAddParticipant(e: React.FormEvent) {
    e.preventDefault();
    setAddParticipantError(null);
    if (!newParticipantName.trim()) {
      setAddParticipantError('名字不能空着');
      return;
    }
    setAddingParticipant(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/participants`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: newParticipantName.trim() }),
      });
      if (!res.ok) {
        setAddParticipantError('添加失败');
        return;
      }
      setNewParticipantName('');
      await loadAll();
    } finally {
      setAddingParticipant(false);
    }
  }

  async function performRevoke(inviteId: string) {
    setConfirming(null);
    await fetch(`/api/trips/${tripId}/invites/${inviteId}`, { method: 'DELETE' });
    await loadAll();
  }

  async function performResetClaim(participantId: string) {
    setConfirming(null);
    await fetch(`/api/trips/${tripId}/participants/${participantId}/reset-claim`, { method: 'POST' });
    await loadAll();
  }

  function inviteUrl(code: string) {
    return `${window.location.origin}/invite/${code}`;
  }

  async function handleCopy(code: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl(code));
      setCopyFailedCode(null);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      setCopyFailedCode(code);
    }
  }


  return (
    // fix(2026-09-16 第十七轮)：gap-8(32px) 收到 gap-2.5(10px)，对齐 Artifact
    // `section.blk{margin-bottom:10px}`，跟这轮其它屏一起收紧的间距同一个量级。
    <div className="flex flex-col gap-2.5">
      {/* fix(2026-09-17 第十九轮，独立 ui-auditor 盲测坐实)：Artifact 顺序是"现有邀请
          列表 → 生成新邀请按钮 → 直接添加参与者"，之前这里顺序是"生成新邀请 → 直接
          添加参与者 → 现有邀请链接 → 参与者认领状态"。这次把"现有邀请链接"挪到最前面，
          对齐方案顺序；"参与者认领状态"是比方案更完整的真功能（round14 已确认），
          留在最后，不在方案覆盖范围内，不用非得塞进方案排的位置。 */}
      <section className="flex flex-col gap-2">
        <h2 className="text-[10px] font-medium tracking-[0.08em] text-neutral-dk">现有邀请链接</h2>
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
                <li key={invite.id} className="flex flex-col gap-1 rounded-xl border border-sand bg-[rgba(164,163,160,.14)] px-[5px] py-[3px] shadow-card">
                  <span className="flex items-start gap-1.5">
                    <span aria-hidden="true">🔗</span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      {invite.inviteeName && <span className="text-[11px] font-medium text-ink">{invite.inviteeName}</span>}
                      <code className="break-all font-mono text-[9px] text-muted">{inviteUrl(invite.code)}</code>
                    </span>
                  </span>
                  <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted">
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
                    <button
                      type="button"
                      onClick={() => handleCopy(invite.code)}
                      className="inline-flex min-h-[24px] shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-sand bg-white px-[9px] text-[10px] font-medium text-ink"
                    >
                      {copiedCode === invite.code ? '已复制' : '复制链接'}
                    </button>
                    {!isRevoked && (
                      <button
                        type="button"
                        onClick={() => setConfirming({ type: 'revoke', id: invite.id })}
                        className="tap-link text-coral"
                      >
                        撤销
                      </button>
                    )}
                  </div>
                  {copyFailedCode === invite.code && (
                    <p className="text-[9px] text-coral">复制失败（浏览器不给剪贴板权限），可以手动选取上面的链接文字复制。</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!genInviteOpen ? (
        <button type="button" onClick={() => setGenInviteOpen(true)} className="big-cta">
          ＋ 生成新邀请
        </button>
      ) : (
        // fix(2026-09-15)：Artifact 这块是带边框的卡片容器（border + padding 7px +
        // 圆角 14px），之前是裸 section 没有这层包装。
        <section className="flex flex-col gap-3 rounded-[14px] border border-sand p-[7px]">
          {/* fix(2026-09-16 第十八轮)：小标题统一成 Artifact `section.blk h4` 规格。 */}
          <h2 className="text-[10px] font-medium tracking-[0.08em] text-neutral-dk">生成新邀请链接</h2>
          <form onSubmit={handleCreateInvite} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="field-label" htmlFor="invitee-name">
                对方名字（可选，方便自己认出这条链接是给谁的）
              </label>
              <input
                id="invitee-name"
                value={inviteeName}
                onChange={(e) => setInviteeName(e.target.value)}
                placeholder="例如：Ben"
                className="field-input w-40"
              />
            </div>
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
      )}

      {/* 屏⑥"直接添加参与者"（2026-09-13 落地第四轮拍板）：纯姓名，没有登录方式，
          建一个跟"邀请链接还没被认领"完全同形状的 participant 占位，自动出现在
          "记一笔消费"分摊名单里（那边本来就是读 participants 表的真实数据）。
          fix(2026-09-14 Artifact Version 10 走查补做)：呈现形态改轻——默认只是一行
          文字链接，点开才展开姓名输入框+添加按钮，不再是常驻的一整块 section。 */}
      {!addParticipantOpen ? (
        <button
          type="button"
          onClick={() => setAddParticipantOpen(true)}
          className="tap-link text-left text-[10.5px] text-muted underline underline-offset-2"
        >
          或者：＋ 直接添加参与者（暂不需要邀请链接）
        </button>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="text-[10px] font-medium tracking-[0.08em] text-neutral-dk">直接添加参与者</h2>
          <p className="text-[10px] text-muted">不需要对方点邀请链接认领，适合对方不方便操作手机的场合，加进来的人只是个占位名字。</p>
          <form onSubmit={handleAddParticipant} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="field-label" htmlFor="new-participant-name">
                名字
              </label>
              <input
                id="new-participant-name"
                value={newParticipantName}
                onChange={(e) => setNewParticipantName(e.target.value)}
                placeholder="例如：司机阿明"
                className="field-input w-40"
              />
            </div>
            <button type="submit" disabled={addingParticipant} className="btn-secondary shrink-0 whitespace-nowrap">
              {addingParticipant ? '添加中…' : '＋ 添加'}
            </button>
          </form>
          {addParticipantError && <p className="text-sm text-coral">{addParticipantError}</p>}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-[10px] font-medium tracking-[0.08em] text-neutral-dk">参与者认领状态</h2>
        <p className="text-xs text-muted">认领错人、换手机号了，可以把某个人重置回未认领状态，让他重新用邀请链接认领。</p>
        {participants === null ? (
          <p className="text-xs text-muted">载入中…</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {participants.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-xl border border-sand bg-[rgba(164,163,160,.14)] px-[5px] py-[3px] shadow-card"
              >
                <span className="flex items-center gap-2 text-[11px]">
                  <Avatar name={p.displayName} size={24} />
                  {p.displayName}
                  {p.isOwner && <span className="ml-2 text-[10px] text-muted">创建者</span>}
                  <span
                    className={`ml-2 inline-flex items-center rounded-full px-[9px] py-[3px] text-[9.5px] font-medium ${
                      p.claimed ? 'bg-ok-bg text-ok' : 'bg-neutral-lt text-neutral-dk'
                    }`}
                  >
                    {p.claimed ? '已认领' : '未认领'}
                  </span>
                </span>
                {p.claimed && !p.isOwner && (
                  <button
                    type="button"
                    onClick={() => setConfirming({ type: 'reset', id: p.id })}
                    className="tap-link text-sm text-muted"
                  >
                    重置认领
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <ConfirmDialog
        open={confirming !== null}
        message={
          confirming?.type === 'revoke'
            ? '确定要撤销这个邀请链接吗？撤销后这个链接就不能再用来认领了。'
            : '确定要重置这个人的认领状态吗？重置后他之前的登录会失效，需要重新用邀请链接认领。'
        }
        confirmLabel={confirming?.type === 'revoke' ? '撤销' : '重置'}
        onConfirm={() => {
          if (!confirming) return;
          if (confirming.type === 'revoke') performRevoke(confirming.id);
          else performResetClaim(confirming.id);
        }}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
