'use client';

import { useState } from 'react';
import { formatMoney } from '@/lib/money';
import { Avatar } from '@/components/avatar';
import { MarkSettledButton } from './mark-settled-button';

export interface SettlementDetailEntryDto {
  expenseId: string;
  category: string;
  expenseDate: string;
  amountBaseCurrency: number;
  role: 'paid' | 'shared';
  excludeFromSplit: boolean;
}

export interface NetEntry {
  participantId: string;
  name: string;
  amount: number;
  detail: SettlementDetailEntryDto[];
}

export interface TransferEntry {
  fromParticipantId: string;
  toParticipantId: string;
  fromName: string;
  toName: string;
  amountBaseCurrency: number;
  confirmed: boolean;
}

/**
 * 结算页正文的客户端外壳（2026-09-13 落地 Artifact Version 10，第四轮拍板屏④）：
 * 净值清单加"查看 XX 的分摊明细 ▾"展开（新功能，之前完全没有）+ 转账清单按笔勾选
 * "已收款"（把 MarkSettledButton 从"全局一键标记"改成"转账进度全部勾完才解锁"）。
 *
 * 持久化：确认状态存 settlement_confirmation 表，只有收款方本人能勾/取消勾，
 * 见 app/api/trips/[tripId]/settlement/confirmations/route.ts。已知简化——确认
 * 只锚定 (from, to) 这一对参与者，不锚定金额，如果期间又有新消费改变了转账金额，
 * 已确认状态不会自动失效，写进 PENDING-DECISIONS 里了。
 */
export function SettlementBody({
  tripId,
  baseCurrency,
  netEntries,
  transfers,
  myParticipantId,
  isOwner,
  alreadySettled,
}: {
  tripId: string;
  baseCurrency: string;
  netEntries: NetEntry[];
  transfers: TransferEntry[];
  myParticipantId: string;
  isOwner: boolean;
  alreadySettled: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmedKeys, setConfirmedKeys] = useState<Set<string>>(
    new Set(transfers.filter((t) => t.confirmed).map((t) => `${t.fromParticipantId}:${t.toParticipantId}`))
  );
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  async function toggleConfirm(t: TransferEntry) {
    const key = `${t.fromParticipantId}:${t.toParticipantId}`;
    const isConfirmed = confirmedKeys.has(key);
    // 只有收款方本人能勾——按钮本身在非收款方视角就已经 disabled，这里再兜底一次，
    // 避免万一 disabled 判断被绕过（比如键盘操作）还是打了一次注定 403 的请求。
    if (t.toParticipantId !== myParticipantId) return;

    setPendingKey(key);
    // 乐观更新：先翻转本地状态，请求失败再翻回去，避免每次点击都要等网络往返才有反馈。
    setConfirmedKeys((prev) => {
      const next = new Set(prev);
      if (isConfirmed) next.delete(key);
      else next.add(key);
      return next;
    });
    try {
      const res = await fetch(`/api/trips/${tripId}/settlement/confirmations`, {
        method: isConfirmed ? 'DELETE' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fromParticipantId: t.fromParticipantId, toParticipantId: t.toParticipantId }),
      });
      if (!res.ok) {
        // 回滚
        setConfirmedKeys((prev) => {
          const next = new Set(prev);
          if (isConfirmed) next.add(key);
          else next.delete(key);
          return next;
        });
      }
    } finally {
      setPendingKey(null);
    }
  }

  const totalTransfers = transfers.length;
  const confirmedCount = transfers.filter((t) => confirmedKeys.has(`${t.fromParticipantId}:${t.toParticipantId}`)).length;
  const allConfirmed = totalTransfers === 0 || confirmedCount === totalTransfers;

  return (
    <>
      {!alreadySettled &&
        isOwner &&
        (totalTransfers > 0 ? (
          <MarkSettledButton
            tripId={tripId}
            disabled={!allConfirmed}
            disabledReason={`转账进度：${confirmedCount}/${totalTransfers} 笔已确认收款，全部确认后才能标记已结算`}
          />
        ) : (
          <MarkSettledButton tripId={tripId} />
        ))}

      <section className="flex flex-col gap-2">
        <h2 className="text-[12.5px] font-semibold text-ink">每人净值</h2>
        <ul className="flex flex-col gap-1 rounded-xl border border-sand bg-[rgba(164,163,160,.14)] px-[5px] py-[3px] shadow-card">
          {netEntries.map((entry) => {
            const isExpanded = expandedId === entry.participantId;
            return (
              <li key={entry.participantId} className="flex flex-col">
                {/* fix(2026-09-15)：行内 padding 3px 改 2px，对齐 Artifact 规格 */}
                <div className="flex items-center gap-2 py-[2px]">
                  <Avatar name={entry.name} size={18} />
                  <span className="flex-1 text-[10.5px]">{entry.name}</span>
                  <span className={`text-[9.5px] ${entry.amount >= 0 ? 'text-positive' : 'text-negative'}`}>
                    {entry.amount >= 0 ? '该收' : '该付'}{' '}
                    <span className="font-serif tabular-nums">
                      {formatMoney(Math.abs(entry.amount), baseCurrency)}
                    </span>
                  </span>
                </div>
                {entry.detail.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : entry.participantId)}
                    // fix(2026-09-15)：字号 10px 改 8.5px，对齐 Artifact `.detail-toggle` 规格
                    className="tap-link self-start pl-[26px] text-[8.5px] text-muted"
                  >
                    查看 {entry.name} 的分摊明细 {isExpanded ? '▲' : '▾'}
                  </button>
                )}
                {isExpanded && (
                  <ul className="ml-[26px] mb-1 flex flex-col gap-0.5 border-l border-sand pl-2">
                    {entry.detail.map((d, i) => (
                      <li key={`${d.expenseId}-${i}`} className="flex items-center justify-between gap-2 text-[10px] text-muted">
                        <span>
                          {d.category} · {d.role === 'paid' ? '垫付' : '分摊'} ·{' '}
                          {new Date(d.expenseDate).toLocaleDateString()}
                          {d.excludeFromSplit && ' · 不计分摊'}
                        </span>
                        <span className={`font-serif tabular-nums ${d.amountBaseCurrency >= 0 ? 'text-positive' : 'text-negative'}`}>
                          {d.amountBaseCurrency >= 0 ? '+' : '-'}
                          {formatMoney(Math.abs(d.amountBaseCurrency), baseCurrency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[12.5px] font-semibold text-ink">转账清单</h2>
        {transfers.length === 0 ? (
          <p className="text-xs text-muted">目前不需要任何转账。</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2 rounded-xl border border-sand bg-[rgba(164,163,160,.14)] px-[6px] py-[4px] shadow-card">
              {transfers.map((t) => {
                const key = `${t.fromParticipantId}:${t.toParticipantId}`;
                const isConfirmed = confirmedKeys.has(key);
                const canToggle = t.toParticipantId === myParticipantId && !alreadySettled;
                return (
                  <li key={key} className="flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
                    <label className={`flex flex-wrap items-center gap-2 ${canToggle ? 'cursor-pointer' : ''}`}>
                      <input
                        type="checkbox"
                        checked={isConfirmed}
                        disabled={!canToggle || pendingKey === key}
                        onChange={() => toggleConfirm(t)}
                        aria-label={`${t.fromName} 转给 ${t.toName} 已收款`}
                      />
                      <Avatar name={t.fromName} size={18} />
                      <span className={isConfirmed ? 'text-muted line-through' : ''}>{t.fromName}</span>
                      <span className="text-muted" aria-hidden="true">
                        →
                      </span>
                      <Avatar name={t.toName} size={18} />
                      <span className={isConfirmed ? 'text-muted line-through' : ''}>{t.toName}</span>
                    </label>
                    <span className="font-serif tabular-nums">{formatMoney(t.amountBaseCurrency, baseCurrency)}</span>
                  </li>
                );
              })}
            </ul>
            {!alreadySettled && (
              <p className="text-[10px] text-muted">
                转账进度：{confirmedCount}/{totalTransfers} 笔已确认收款
                {!transfers.some((t) => t.toParticipantId === myParticipantId) && '（只有收款方本人能勾选确认）'}
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
}
