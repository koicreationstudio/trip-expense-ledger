'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { UserTripSummary } from '@/lib/db/user-trips-query';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useDismissableOpen } from '@/components/select-dropdown';
import { LogoutButton } from './logout-button';

/**
 * fix(2026-09-16 第十七轮，Remy 拿真实截图逐项比对 Artifact V10「02 行程主页」屏，
 * 这轮之前 header/切换行程下拉/subtab 全部对不上，不是小打小闹)：
 *
 * 这个文件合并了原来 trip-switcher.tsx + nav-links.tsx 两个组件——不是为了少写文件，
 * 是因为 Artifact `.topbar-row → .dropdown-panel → .navtabs` 这三块在真实 DOM 里
 * 是同一层的纵向排列（.dropdown-panel 展开时是普通文档流内容，把 .navtabs 往下推，
 * 不是浮在别的内容上面的悬浮层），要做到这个效果，下拉面板必须跟标题行、subtab
 * 是同一个 flex-col 容器里的兄弟节点，宽度天然占满整个内容列。旧实现里
 * TripSwitcher 只包了触发按钮那一小块（在右上角 topbar-actions 那条窄列里），
 * 下拉面板用 `absolute` 悬浮在触发按钮下面、宽度只有 `min-w-[220px]`，实测会在
 * 手机宽度下溢出右边裁切（Remy 截图里那个"管理行程"面板被切掉一截就是这个）。
 * 这次不修 CSS 数值，是把结构改成跟方案一样的"从上到下一条流"。
 *
 * 拆出来揉在一起的两块原有职责完全没变，逐条对照：
 * - 切换/删除行程、鉴权判断（canOpenPanel）——原 trip-switcher.tsx 的业务逻辑原样保留
 * - 当前 tab 高亮（usePathname）——原 nav-links.tsx 的逻辑原样保留
 */
export function TripHeaderNav({
  tripId,
  tripName,
  subtitle,
  accountHref,
  otherTrips,
  isOwner,
  navLinks,
}: {
  tripId: string;
  tripName: string;
  subtitle: string;
  accountHref: string;
  otherTrips: UserTripSummary[];
  isOwner: boolean;
  navLinks: { href: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // fix(2026-09-24 第三十九轮，团队看板反馈"点空白/Escape 关不掉")：这颗"切到其它
  // 行程"面板之前只有触发按钮自己的 onClick 能开关，没接住点空白处/按 Escape 关闭——
  // 跟 fx-compare-card.tsx 那两处是同一类漏网（详见 select-dropdown.tsx 顶部说明）。
  // 这个面板本身是整块管理面板（切换行程按钮+删除图标+"新建行程"链接混排），跟
  // `SelectDropdown` 的"选一个 value"单选形状对不上，套不进那个组件本体，但"点空白/
  // Escape 关闭"这段行为改用同一个共用 hook，不用重新手写一份监听器。
  const dismissRef = useDismissableOpen(open, () => setOpen(false));
  // fix(2026-09-24 第六十四轮，Bug B「展开的东西跨页面导航后还开着」横扫出来的实例)：
  // 这个组件挂在 trip 共享布局里，切 tab（行程主页/结算/支付方式/邀请管理）时布局不
  // 重新挂载，`open` 会原样带到下一页。而且 tab 链接就在这同一个 header 容器里，
  // 点它不算"点空白"，useDismissableOpen 也不会关。生产实测：面板开着点「结算」tab，
  // 到了结算页面板还展开着（修前 1/1 复现）。路径一变就收起。
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 没有下拉可开（既不是 owner、名下也没有其它行程能切）时，标题那边已经显示了
  // 行程名，不渲染这颗按钮——跟原 trip-switcher.tsx 的判断完全一致。
  const canOpenPanel = otherTrips.length > 0 || isOwner;

  async function handleSwitch(targetTripId: string) {
    setError(null);
    setSwitchingId(targetTripId);
    try {
      const res = await fetch('/api/account/switch-trip', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tripId: targetTripId }),
      });
      if (!res.ok) {
        setError('切换失败，刷新页面再试一次');
        return;
      }
      setOpen(false);
      router.push(`/trips/${targetTripId}`);
      router.refresh();
    } finally {
      setSwitchingId(null);
    }
  }

  async function handleDeleteConfirmed() {
    if (!confirming || deleting) return;
    const target = confirming;
    setError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/trips/${target.id}`, { method: 'DELETE' });
      if (!res.ok) {
        setError('删除失败，刷新页面再试一次');
        setConfirming(null);
        return;
      }

      setConfirming(null);

      if (target.id !== tripId) {
        router.refresh();
        return;
      }

      setOpen(false);
      const nextTrip = otherTrips.find((t) => t.id !== target.id);
      if (nextTrip) {
        const switchRes = await fetch('/api/account/switch-trip', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tripId: nextTrip.id }),
        });
        if (switchRes.ok) {
          router.push(`/trips/${nextTrip.id}`);
          router.refresh();
          return;
        }
      }
      router.push('/');
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div ref={dismissRef} className="flex flex-col gap-2">
      {/* topbar-row：Artifact `.title-block h3{font-size:15px;font-weight:700}` /
          `.title-block p{font-size:10.5px}` / `.account-links{font-size:10.5px}` +
          `a{text-decoration:underline}`（一直是下划线，不是只有 hover 才有）/
          `.trip-pill{padding:4px 9px;font-size:11px;font-weight:500}` 逐值核对过。 */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-bold text-ink">{tripName}</h1>
          <p className="text-[10.5px] text-muted">{subtitle}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-[10px]">
            <Link
              href={accountHref}
              className="text-[10.5px] text-muted underline underline-offset-2 hover:text-ink"
            >
              我的账号
            </Link>
            <LogoutButton />
          </div>
          {canOpenPanel && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded-full bg-ink px-[9px] py-1 text-[11px] font-medium text-white transition-colors hover:bg-accent-800"
            >
              {tripName}
              <span aria-hidden="true">▾</span>
            </button>
          )}
        </div>
      </div>

      {/* dropdown-panel：Artifact 里这是 `.topbar-row` 后面紧跟着的普通文档流内容，
          宽度占满整个内容列——改成跟标题行同一个 flex-col 容器里的普通兄弟节点，
          不再是 `absolute` 悬浮在触发按钮右下角、会在窄屏溢出裁切的悬浮层。
          fix(2026-09-26 第七十一轮，Remy 明确要求)：去掉顶部"展开：切到其它行程/
          管理行程"这句说明文字标题行（面板本身已经通过点击触发按钮打开，不需要
          额外一句话解释这是什么），"＋ 新建行程"从标题行挪到列表最底部，变成
          列表的最后一项，视觉上跟其它行程项同一套列表节奏（同样的 border-t 分隔线），
          只是文字样式换成强调色，表明这是一个"新增"动作而不是"切换"动作。 */}
      {canOpenPanel && open && (
        <div className="w-full rounded-[14px] border border-sand bg-paper p-1 shadow-card">
          {error && <p className="px-[6px] pb-1 pt-[2px] text-[10px] text-coral">{error}</p>}
          <ul className="flex flex-col">
            <li className="flex items-center gap-[6px] rounded-[8px] bg-[#EBEAE8] px-[6px] py-[4px]">
              <span className="w-[9px] shrink-0 text-center text-[7px] leading-none text-ink" aria-hidden="true">
                ●
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-ink">{tripName}</span>
              <span className="shrink-0 text-[10px] text-ink" aria-hidden="true">
                ✓
              </span>
              {isOwner && (
                <button
                  type="button"
                  onClick={() => setConfirming({ id: tripId, name: tripName })}
                  className="tap-link shrink-0 text-[10px] text-coral"
                  aria-label={`删除「${tripName}」`}
                >
                  🗑
                </button>
              )}
            </li>
            {otherTrips.map((trip) => (
              <li
                key={trip.id}
                className="flex items-center gap-[6px] border-t border-[rgba(55,55,54,.07)] px-[6px] py-[4px]"
              >
                <span className="w-[9px] shrink-0 text-center text-[7px] leading-none text-[#B5B4B1]" aria-hidden="true">
                  ●
                </span>
                <button
                  type="button"
                  onClick={() => handleSwitch(trip.id)}
                  disabled={switchingId === trip.id}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-50"
                >
                  <span className="min-w-0 truncate text-[11px] font-normal text-ink">
                    {trip.name}
                    {switchingId === trip.id && <span className="ml-2 text-[10px] text-muted">切换中…</span>}
                  </span>
                </button>
                {trip.isOwner && (
                  <button
                    type="button"
                    onClick={() => setConfirming({ id: trip.id, name: trip.name })}
                    className="tap-link shrink-0 text-[10px] text-coral"
                    aria-label={`删除「${trip.name}」`}
                  >
                    🗑
                  </button>
                )}
              </li>
            ))}
            <li className="border-t border-[rgba(55,55,54,.07)] px-[6px] py-[4px]">
              <Link
                href="/trips/new"
                className="flex items-center gap-[6px] text-[11px] font-medium text-neutral-dk underline underline-offset-2"
              >
                <span className="w-[9px] shrink-0 text-center text-[10px] leading-none" aria-hidden="true">
                  ＋
                </span>
                新建行程
              </Link>
            </li>
          </ul>
        </div>
      )}

      {/* navtabs：Artifact `.navtabs{background:neutral-lt;border-radius:999px;padding:3px;gap:4px}`
          `.navtabs button{padding:6px 12px;border-radius:999px;font-size:11px;font-weight:500;color:neutral-dk}`
          `.navtabs button.on{background:ink;color:#fff}`——方案里没有任何一个 tab 带下划线
          （选中态靠深色胶囊背景区分，不是靠下划线）。旧实现复用了 `.tap-link` 这个全站
          共享 class，那个 class 是给"编辑/删除/撤销"这类行内文字链接用的，天生带
          `underline`，被 subtab 借用后四个 tab（选中的和没选中的）全部长了下划线——
          这是这轮真的抓到的 bug，不是凭感觉猜的，`.tap-link` 定义见 app/globals.css。 */}
      <nav className="flex w-fit flex-wrap gap-1 rounded-full bg-neutral-lt p-[3px] text-[11px]">
        {navLinks.map((link) => {
          const isActive = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={
                isActive
                  ? 'inline-flex items-center rounded-full bg-ink px-[12px] py-[6px] font-medium text-white'
                  : 'inline-flex items-center rounded-full px-[12px] py-[6px] font-medium text-neutral-dk hover:text-ink'
              }
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      <ConfirmDialog
        open={confirming !== null}
        message={`确定要删除「${confirming?.name ?? ''}」吗？这趟行程下所有消费记录、钱包、换汇记录、参与者都会一起永久清空，无法恢复。`}
        confirmLabel={deleting ? '删除中…' : '删除'}
        cancelLabel="取消"
        variant="danger"
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
