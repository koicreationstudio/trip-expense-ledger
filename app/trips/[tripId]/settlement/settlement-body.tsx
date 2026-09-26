'use client';

import { Fragment, useState } from 'react';
import { formatMoney } from '@/lib/money';
import { Avatar } from '@/components/avatar';
import { Switch } from '@/components/switch';
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

/**
 * 转账清单按币种拆开显示（2026-09-26）：同一对 from/to 名下不管欠几个币种，
 * 都合并成一个"转账组"，组内每个币种各自一行（不再细分支付方式），各自有自己
 * 的"已收款"勾选状态——htoo 还清了 HKD 那笔不代表 MYR/CNY 也还清了。
 */
export interface CurrencyLineDto {
  currency: string;
  amountOriginal: number; // 原始币种金额，展示用
  amountBaseCurrency: number; // 本位币金额，精确
  confirmed: boolean;
}

export interface TransferGroupEntry {
  fromParticipantId: string;
  toParticipantId: string;
  fromName: string;
  toName: string;
  lines: CurrencyLineDto[];
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
  transferGroups,
  myParticipantId,
  isOwner,
  alreadySettled,
}: {
  tripId: string;
  baseCurrency: string;
  netEntries: NetEntry[];
  transferGroups: TransferGroupEntry[];
  myParticipantId: string;
  isOwner: boolean;
  alreadySettled: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // key 现在是 `${from}:${to}:${currency}`——每个币种分行各自独立的"已收款"状态。
  const [confirmedKeys, setConfirmedKeys] = useState<Set<string>>(
    new Set(
      transferGroups.flatMap((g) =>
        g.lines.filter((l) => l.confirmed).map((l) => `${g.fromParticipantId}:${g.toParticipantId}:${l.currency}`)
      )
    )
  );
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  async function toggleConfirm(group: TransferGroupEntry, line: CurrencyLineDto) {
    const key = `${group.fromParticipantId}:${group.toParticipantId}:${line.currency}`;
    const isConfirmed = confirmedKeys.has(key);
    // 只有收款方本人能勾——按钮本身在非收款方视角就已经 disabled，这里再兜底一次，
    // 避免万一 disabled 判断被绕过（比如键盘操作）还是打了一次注定 403 的请求。
    if (group.toParticipantId !== myParticipantId) return;

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
        body: JSON.stringify({
          fromParticipantId: group.fromParticipantId,
          toParticipantId: group.toParticipantId,
          currency: line.currency,
        }),
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

  // 转账进度现在按"币种分行"数，不是按"转账组"数——一对 from/to 名下有 3 个币种
  // 就是 3 笔要确认，不是 1 笔。
  const allLines = transferGroups.flatMap((g) =>
    g.lines.map((l) => ({ group: g, line: l, key: `${g.fromParticipantId}:${g.toParticipantId}:${l.currency}` }))
  );
  const totalTransfers = allLines.length;
  const confirmedCount = allLines.filter((entry) => confirmedKeys.has(entry.key)).length;
  const allConfirmed = totalTransfers === 0 || confirmedCount === totalTransfers;

  return (
    // fix(2026-09-24，结算页结构性重做，逐字核对 reference/artifact-v10-source.html
    // 第846-891行"权威 Artifact 源"，不是凭截图猜结构)：Remy 拿生产截图跟设计稿逐屏
    // 肉眼比对（不是比 CSS 数值——round42 那次只核对了 CSS token 数值，查不出这类
    // 结构问题，这是那次假阳性的根因），确认了一处结构性偏差：每人净值本该是各自
    // 独立的胶囊卡（Artifact 每人各自一个 <div class="list">），之前误合并成一个
    // 共享大框，这次改回逐人独立卡片。
    // fix(2026-09-24 第五十轮，Remy 追加更精确的反馈，推翻本节上一版的宽度判断)：
    // 上一版这里自己另定了 max-w-[390px]（取自 Artifact 设计稿画布尺寸），理由是
    // "结算内容量小，768px 下显得松散"。Remy 之后明确说宽度要跟这个 app 其它页面
    // （行程主页 page.tsx 的 <main>、支付方式页 payment-methods-manager.tsx 的根
    // 容器）用同一个容器宽度约定，去代码里找现成的 max-width 复用，不要另定一个数。
    // 查过这两处页面的根节点，两边都没有再叠加任何 max-w class，宽度完全交给
    // app/layout.tsx 唯一的 `mx-auto max-w-3xl`（768px）容器决定——所以这里去掉
    // 自定义的 390px 上限，不再额外收窄，让净值/转账区的左边缘和宽度真的跟"结算"
    // 标题、顶部 tab、以及行程主页/支付方式页对齐在同一条基准线上。"768px 下内容
    // 量小、金额被推得靠右显得松散"这个观感判断本身可能还是真的，但这不是这次自己
    // 该再拍一次板的地方——如实报给 PM，由她转达 Remy 定，不在这里静默覆盖。
    <div className="flex w-full flex-col gap-3.5">
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
        {netEntries.map((entry) => {
          const isExpanded = expandedId === entry.participantId;
          return (
            <Fragment key={entry.participantId}>
              {/* fix(2026-09-24)：之前所有人共用一个 <ul> 大框（一个 border+底色的
                  盒子把 Remy/htoo 都装进去），跟 Artifact 字面结构（每人各自一个
                  独立的 .list 胶囊：`<div class="list"><div class="p-row">...`）
                  不一样——这次改成每人各自一个独立的 rounded-[14px] 胶囊 <ul>，
                  规格（border-radius:14px、padding 3px 5px）跟之前核对过的值完全
                  没动，只是从"共享大框"拆成"逐人独立卡"。 */}
              <ul className="flex flex-col rounded-[14px] border border-sand bg-[rgba(164,163,160,.14)] px-[5px] py-[3px] shadow-card">
                <li className="flex items-center gap-[5px] py-[2px]">
                  <Avatar name={entry.name} size={18} />
                  <span className="flex-1 text-[10.5px]">{entry.name}</span>
                  <span className={`text-[9.5px] ${entry.amount >= 0 ? 'text-positive' : 'text-negative'}`}>
                    {entry.amount >= 0 ? '该收' : '该付'}{' '}
                    <span className="font-serif tabular-nums">
                      {formatMoney(Math.abs(entry.amount), baseCurrency)}
                    </span>
                  </span>
                </li>
              </ul>
              {entry.detail.length > 0 && (
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : entry.participantId)}
                  // fix(2026-09-24)：之前借用全局 .tap-link（min-h-[32px] 触控热区），
                  // 32px 的隐形点击区域在 8.5px 小字周围留出一圈看不见但占位的空气，
                  // 是 Remy 反馈"每人下面留了一大块空白，链接位置不对"的真实成因之一。
                  // Artifact `.detail-toggle{all:unset;...}` 本来就没有任何触控热区
                  // padding，这次改成贴着这个规格来的最小样式，不再借用 .tap-link——
                  // 其它用 .tap-link 的地方（编辑/删除/撤销/复制这类）不受影响，只是
                  // 这一处不再复用那个 class。现在这颗按钮是紧跟着上面胶囊卡的兄弟
                  // 元素（不再嵌在卡片内部），跟 section 的 gap-2(8px) 一起，链接紧贴
                  // 卡片下方，不再留出一大块空白。
                  className="self-start ml-[25px] text-[8.5px] text-muted underline underline-offset-2"
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
                        {/* 这次命名纠正任务（2026-09-26）：文案从"不计分摊"改成
                            "业务成本"，判断依据（d.excludeFromSplit）没变——见
                            expense-list.tsx 同款标签处的注释，不重复抄一遍原因。 */}
                        {d.excludeFromSplit && (
                          <span className="ml-1 inline-flex items-center rounded-full bg-[rgba(164,163,160,.3)] px-[5px] py-[1px] align-middle text-[8px] font-normal text-muted">
                            业务成本
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
            </Fragment>
          );
        })}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[10px] font-medium tracking-[0.08em] text-neutral-dk">转账清单</h2>
        {transferGroups.length === 0 ? (
          <p className="text-xs text-muted">目前不需要任何转账。</p>
        ) : (
          <>
            {/* fix(2026-09-26，"结算按币种拆开显示")：转账清单从"一对 from/to 一行"
                改成"一对 from/to 一组，组内每个币种各自一行 + 一个合计"——同一个币种
                不管当时用哪种支付方式付的，都合并成一行，不再细分支付方式。组与组
                之间用同样的胶囊卡包一层，组内用 border-top 分隔各币种行，规格延续
                之前"净值清单"分类明细那套（bg rgba(164,163,160,.14) + border sand +
                radius 14px），不是另起一套新样式。 */}
            {transferGroups.map((group) => {
              const groupKey = `${group.fromParticipantId}:${group.toParticipantId}`;
              const totalBaseCurrency = group.lines.reduce((sum, l) => sum + l.amountBaseCurrency, 0);
              return (
                <ul
                  key={groupKey}
                  className="flex flex-col gap-[2px] rounded-[14px] border border-sand bg-[rgba(164,163,160,.14)] px-[5px] py-[3px] shadow-card"
                >
                  <li className="flex items-center gap-[5px] py-[2px] text-[10.5px]">
                    <span>{group.fromName}</span>
                    <span className="text-muted" aria-hidden="true">
                      →
                    </span>
                    <span>{group.toName}</span>
                  </li>
                  {group.lines.map((line, i) => {
                    const key = `${groupKey}:${line.currency}`;
                    const isConfirmed = confirmedKeys.has(key);
                    const canToggle = group.toParticipantId === myParticipantId && !alreadySettled;
                    // 原始币种就是行程本位币时，两个数字完全一样，不重复显示括号里的
                    // "≈本位币等值"——只有换算过的币种才需要那个参考数字。
                    const showBaseEquivalent = line.currency !== baseCurrency;
                    return (
                      <li
                        key={key}
                        className={`flex flex-wrap items-center gap-[5px] py-[2px] ${i > 0 ? 'border-t border-sand' : ''}`}
                      >
                        <span className="text-[9px] text-muted">{line.currency}</span>
                        <span className="ml-auto flex items-center gap-[5px]">
                          <Switch
                            id={`settle-confirm-${key}`}
                            checked={isConfirmed}
                            disabled={!canToggle || pendingKey === key}
                            onChange={() => toggleConfirm(group, line)}
                            ariaLabel={`${group.fromName} 转给 ${group.toName} 的 ${line.currency} 已收款`}
                          />
                          <label
                            htmlFor={`settle-confirm-${key}`}
                            className={`text-[9.5px] text-muted ${canToggle ? 'cursor-pointer' : ''}`}
                          >
                            已收款
                          </label>
                        </span>
                        <span
                          className={`font-serif text-[9.5px] tabular-nums ${isConfirmed ? 'text-muted line-through' : ''}`}
                        >
                          {showBaseEquivalent && '≈'}
                          {formatMoney(line.amountOriginal, line.currency)}
                          {showBaseEquivalent && (
                            <span className="text-muted">
                              {' '}
                              (≈{formatMoney(line.amountBaseCurrency, baseCurrency)})
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                  {group.lines.length > 1 && (
                    <li className="flex items-center gap-[5px] border-t border-sand py-[2px] text-[9.5px]">
                      <span className="text-muted">合计</span>
                      <span className="ml-auto font-serif tabular-nums">
                        ≈{formatMoney(totalBaseCurrency, baseCurrency)}
                      </span>
                    </li>
                  )}
                </ul>
              );
            })}
            {!alreadySettled && (
              <p className="text-[10px] text-muted">
                转账进度：{confirmedCount}/{totalTransfers} 笔已确认收款
                {!transferGroups.some((g) => g.toParticipantId === myParticipantId) &&
                  '（只有收款方本人能勾选确认）'}
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
      {/* fix(2026-09-24，round46 顺带修复"手机视口展开较长分摊明细时 FAB 压住最后一笔"）：
          底部常驻"记一笔消费"操作条（.action-bar，高度是 app/globals.css 里唯一的真实
          来源 --action-bar-h，量出来是 60px）在 TripLayout 那一层已经有 .action-bar-reserve
          统一预留同高度的底部空白——但那份预留是按"整个页面的最终高度"算的，round46 独立
          ui-auditor 用真实滚动到位截图（非 fullPage）在手机视口展开 17 行分摊明细后，仍然
          复现了操作条压住最后一笔的问题。这里不改 TripLayout（那是全站共用的机制，改了
          影响所有页面），只在结算页内容区自己的底部，展开了任意一条分摊明细时，额外再叠
          一层跟 --action-bar-h 同源（不是另外拍一个数字，取的是操作条自己唯一的高度来源）
          的安全间距，双保险；没有展开任何明细时不加，不会让正常状态平白多出一截空白。 */}
      {expandedId && <div aria-hidden="true" style={{ height: 'var(--action-bar-h)' }} />}
    </div>
  );
}
