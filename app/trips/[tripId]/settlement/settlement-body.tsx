'use client';

import { useState } from 'react';
import { formatMoney } from '@/lib/money';
import { Avatar } from '@/components/avatar';
import { MarkSettledButton } from './mark-settled-button';

export interface SettlementDetailEntryDto {
  expenseId: string;
  category: string;
  // 商家名称，可空（2026-09-18 补上，跟活动流同一套"商家名优先"展示规则）。
  merchant: string | null;
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
      {/* fix(2026-09-16 round14 地毯式核对)：Artifact 把这颗按钮放在两份清单最后面，
          当成"看完净值+转账清单再确认"的最后一步 CTA；这里之前放在最顶上，先于两份
          清单出现，进页面第一眼就看到一个"标记已结算"按钮，还没看数字就先看到确认
          按钮，跟 Artifact 的"review 完了才按"顺序不一样，也不方便——往下勾"已收款"
          时按钮的解锁状态在屏幕外看不到。这次挪到底部，逻辑（disabled/文案）完全没动，
          只是 JSX 位置从两份清单前面搬到后面。 */}
      <section className="flex flex-col gap-2">
        {/* fix(2026-09-16 第十八轮，Remy 拍板"区块小标题统一成方案的灰色大写风格")：
            Artifact `section.blk h4{font-size:10px;font-weight:500;color:neutral-dk;
            letter-spacing:.08em}`——这次全站扫了一遍同类小标题（每人净值/转账清单/
            活动流/换汇/已配置的支付方式/本行程启用的支付方式/新增支付方式/生成新邀请
            链接/直接添加参与者/现有邀请链接/参与者认领状态），统一改成这套值，不是
            只改这一处。 */}
        <h2 className="text-[10px] font-medium tracking-[0.08em] text-neutral-dk">每人净值</h2>
        {/* fix(2026-09-17 第二十轮，Remy 要求逐 CSS token 核对结算屏)：`.list`
            的字面规格是 border-radius:14px（之前是 Tailwind `rounded-xl`=12px，
            差 2px 肉眼其实能看出来）+ gap:2px（之前 `gap-1`=4px，多了整整一倍）；
            `.p-row` 的 gap 是 5px（之前 `gap-2`=8px）。padding 3px/5px 之前就是
            对的，这次连带核对了一遍确认没漂。 */}
        <ul className="flex flex-col gap-[2px] rounded-[14px] border border-sand bg-[rgba(164,163,160,.14)] px-[5px] py-[3px] shadow-card">
          {netEntries.map((entry) => {
            const isExpanded = expandedId === entry.participantId;
            return (
              <li key={entry.participantId} className="flex flex-col">
                <div className="flex items-center gap-[5px] py-[2px]">
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
                    // Artifact `.detail-toggle{margin:0 0 4px 25px}`——之前用
                    // pl-[26px] 凑近似值，这次改成字面一致的 ml-[25px]+mb-1(4px)。
                    className="tap-link self-start ml-[25px] mb-1 text-[8.5px] text-muted"
                  >
                    查看 {entry.name} 的分摊明细 {isExpanded ? '▲' : '▾'}
                  </button>
                )}
                {isExpanded && (
                  // fix(2026-09-17 第二十轮)：之前这里是"左边一条竖线缩进"的列表
                  // （border-l + pl-2），跟 Artifact `.settle-detail` 的真实规格
                  // （浅底色圆角盒子、盒内用 border-top 分隔行，不是竖线缩进）完全
                  // 是两套不同的视觉语言。改成字面对齐：bg rgba(164,163,160,.14)
                  // + border sand + radius 14px + padding 2px 7px + margin-bottom
                  // 7px，每行 padding 4px 0、gap 7px、字号 10px，meta（垫付/分摊·
                  // 日期）9px、金额 10px 半粗体——分类/日期/角色/不计分摊标签这些
                  // 字段方案demo没有全部对应（demo 不区分"垫付/分摊"角色），这是
                  // 真实需要的信息，塞进 meta 小字里，不因为对齐方案就把真信息丢了。
                  <div className="ml-[25px] mb-[7px] flex flex-col rounded-[14px] border border-sand bg-[rgba(164,163,160,.14)] px-[7px] py-[2px]">
                    {entry.detail.map((d, i) => {
                      // fix(2026-09-18)：商家名优先显示（跟活动流 expense-list.tsx
                      // 的 primaryName 同一条规则），没填商家名的历史/手动记录退回
                      // 显示分类——分类信息不会凭空消失，填了商家名时挪去 meta 行。
                      const merchantName = d.merchant?.trim();
                      const primaryName = merchantName || d.category;
                      const metaParts = [d.role === 'paid' ? '垫付' : '分摊', new Date(d.expenseDate).toLocaleDateString()];
                      if (merchantName) metaParts.push(d.category);
                      return (
                      <div
                        key={`${d.expenseId}-${i}`}
                        className={`flex items-center gap-[7px] py-1 text-[10px] ${i > 0 ? 'border-t border-sand' : ''}`}
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {primaryName}
                          {d.excludeFromSplit && (
                            <span className="ml-1 inline-flex items-center rounded-full bg-[rgba(164,163,160,.3)] px-[5px] py-[1px] align-middle text-[8px] font-normal text-muted">
                              不计分摊
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-[9px] text-muted">
                          {metaParts.join(' · ')}
                        </span>
                        <span
                          className={`ml-auto shrink-0 font-serif text-[10px] font-semibold tabular-nums ${
                            d.amountBaseCurrency >= 0 ? 'text-positive' : 'text-negative'
                          }`}
                        >
                          {d.amountBaseCurrency >= 0 ? '+' : '-'}
                          {formatMoney(Math.abs(d.amountBaseCurrency), baseCurrency)}
                        </span>
                      </div>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[10px] font-medium tracking-[0.08em] text-neutral-dk">转账清单</h2>
        {transfers.length === 0 ? (
          <p className="text-xs text-muted">目前不需要任何转账。</p>
        ) : (
          <>
            {/* fix(2026-09-17 第二十轮)：转账清单跟净值清单是同一个 `.list` class，
                走的是同一套 radius 14px / gap 2px / padding 3px 5px，之前这里各写
                各的（rounded-xl/gap-2/px-6 py-4），跟净值清单不统一，这次对齐同一套
                值。行内 `.p-row{gap:5px}`（之前 gap-2=8px）、姓名字号 10.5px、
                "已收款"提示字/金额 9.5px（之前整行统一用 11.5px，没有照 Artifact
                区分"名字比金额/提示字大一号"这个层级）。
                fix(2026-09-17 第二十二轮，Remy 明确表态"要"去掉头像)：round21 曾判断
                "保留头像帮助一眼认人"，这轮 Remy 直接拍板照方案字面来——方案demo这里
                只有"Alex → Remy"纯文字，没有头像，去掉，不再保留论证。 */}
            <ul className="flex flex-col gap-[2px] rounded-[14px] border border-sand bg-[rgba(164,163,160,.14)] px-[5px] py-[3px] shadow-card">
              {transfers.map((t) => {
                const key = `${t.fromParticipantId}:${t.toParticipantId}`;
                const isConfirmed = confirmedKeys.has(key);
                const canToggle = t.toParticipantId === myParticipantId && !alreadySettled;
                return (
                  <li key={key} className="flex flex-wrap items-center gap-[5px] py-[2px]">
                    <span className={`text-[10.5px] ${isConfirmed ? 'text-muted line-through' : ''}`}>
                      {t.fromName}
                    </span>
                    <span className="text-muted" aria-hidden="true">
                      →
                    </span>
                    <span className={`text-[10.5px] ${isConfirmed ? 'text-muted line-through' : ''}`}>
                      {t.toName}
                    </span>
                    {/* fix(2026-09-17 第十九轮，独立 ui-auditor 盲测坐实)：Artifact 每一行
                        checkbox 旁边都有个可见的"已收款"文字标签（`<span class="hint">已收款</span>`），
                        之前只写了 aria-label，屏幕上看不到任何文字说明这个勾选框是干嘛的。 */}
                    <label className={`ml-auto flex items-center gap-[5px] ${canToggle ? 'cursor-pointer' : ''}`}>
                      <input
                        type="checkbox"
                        checked={isConfirmed}
                        disabled={!canToggle || pendingKey === key}
                        onChange={() => toggleConfirm(t)}
                        aria-label={`${t.fromName} 转给 ${t.toName} 已收款`}
                      />
                      <span className="text-[9.5px] text-muted">已收款</span>
                    </label>
                    <span className="font-serif text-[9.5px] tabular-nums">
                      {formatMoney(t.amountBaseCurrency, baseCurrency)}
                    </span>
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

      {/* fix(2026-09-17 第十九轮，独立 ui-auditor 盲测坐实)：Artifact 底部只有一个元素——
          `<button class="big-cta" disabled>等所有转账确认收款后 · 整个行程才会标记已结算</button>`，
          没收齐时按钮本身的文字就是这句话，不是"按钮 + 按钮下面单独再写一遍转账进度"。
          之前 MarkSettledButton 收到一个 disabledReason 在按钮下方另起一行，
          内容跟上面「转账清单」区块已经出现过的"转账进度：X/Y笔已确认收款"重复了两遍。
          这次拿掉 disabledReason，"没收齐"这个状态改成按钮自己的文案，不再重复。 */}
      {!alreadySettled && isOwner && <MarkSettledButton tripId={tripId} disabled={!allConfirmed} />}
    </>
  );
}
