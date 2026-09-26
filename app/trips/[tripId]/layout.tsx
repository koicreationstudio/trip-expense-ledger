import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import { trips } from '@/lib/db/schema';
import { getCurrentIdentity } from '@/lib/auth/current-session';
import { getCurrentUser } from '@/lib/auth/current-user';
import { loadUserTripsWithBalance } from '@/lib/db/user-trips-query';
import { TRIP_STATUS_LABEL } from '@/lib/domain/trip-status';
import { RecordExpenseBar } from './record-expense-bar';
import { TripHeaderNav } from './trip-header-nav';

/**
 * 共享布局：顶部导航栏（行程名+本位币、记一笔/行程主页/结算/支付方式几个链接，
 * owner 才显示邀请管理，右边退出登录按钮）。沿用 getCurrentIdentity() 判断
 * owner 状态——跟各 page.tsx 自己做的鉴权判断是同一套 Layer 1 逻辑，只是抽到
 * 这一层统一画导航，各 page.tsx 不用大改，自己该有的数据查询照旧保留。
 */
export default async function TripLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { tripId: string };
}) {
  const identity = await getCurrentIdentity();
  // round48 临时诊断：跟 wrangler tail 对表，确认"看起来跳错页/弹回未登录"的
  // 那一刻服务端到底有没有真的收到这次请求（没收到=纯客户端缓存渲染的假象，
  // 不是这里的鉴权逻辑判定失败的）。排查结束后删除。
  console.log(
    `[diag-server] TripLayout tripId=${params.tripId} identity=${identity ? `${identity.tripId}/${identity.participantId}` : 'null'}`
  );
  if (!identity || identity.tripId !== params.tripId) {
    // fix(2026-09-26 第七十二轮，round72 A组⑥①，根治"直接输网址有时停在上一趟
    // 行程"的真根因)：之前这里不管三七二十一直接弹回首页——Layer 1 tel_session
    // 当前指着别的行程时，首页又会把人送回 identity.tripId 那趟"当前激活"的行程，
    // 完全没检查这个人是不是透过 Layer 2 账号真的拥有这趟目标行程。改成先看有没有
    // Layer 2 账号，有就先去 /api/account/auto-switch-trip/{tripId} 查一下这个账号
    // 在目标行程里有没有合法 participant，有就地铸一个新 tel_session 再跳回来，
    // 没有才真的弹回首页（跟原来行为一致）。纯访客 tel_session（没有 Layer 2 账号）
    // 维持原来的行为不变，直接弹回首页。详见那个 route 文件顶部注释。
    const user = await getCurrentUser();
    if (user) {
      redirect(`/api/account/auto-switch-trip/${params.tripId}`);
    }
    redirect('/');
  }

  const db = await getDb();
  const trip = await db.query.trips.findFirst({ where: eq(trips.id, params.tripId) });
  if (!trip) {
    redirect('/');
  }

  // 行程切换入口：只有登录了账号（Layer 2）的人才可能名下有不止一个行程，
  // 单纯扫邀请链接认领的同行人没有账号，otherTrips 会是空数组，TripSwitcher
  // 自己判断空数组时退回纯文字，不渲染下拉。
  const user = await getCurrentUser();
  const otherTrips = user
    ? (await loadUserTripsWithBalance(db, user.userId)).filter((t) => t.id !== trip.id)
    : [];

  // "记一笔消费"是全站最高频动作，不跟其它次要链接混排在这条导航里——
  // 挪到下面固定在屏幕底部的常驻操作条，单手持机时拇指自然落点就能点到。
  const navLinks = [
    { href: `/trips/${trip.id}`, label: '行程主页' },
    { href: `/trips/${trip.id}/settlement`, label: '结算' },
    { href: `/trips/${trip.id}/payment-methods`, label: '支付方式' },
    ...(identity.isOwner ? [{ href: `/trips/${trip.id}/invites`, label: '邀请管理' }] : []),
  ];

  // action-bar-reserve：底部操作条是 fixed 的，不占文档流，靠这条 padding 把它那一横带
  // 从内容区里扣掉。高度跟操作条共用 --action-bar-h，所以"滚到底时操作条底下压的是这段
  // 空白、不是内容"这条保证不会因为改内边距而漂掉。（替掉了原来那个 pb-28——112px 是当年
  // 为悬浮胶囊留的估算余量，跟胶囊实际高度没有任何机械关联，胶囊一改高度就失效。）
  //
  // fix(2026-09-16 第十七轮，Remy 拿真实截图逐屏比对 Artifact V10 发现的一批 header 问题)：
  // - 之前 header 外层有 `border-b border-sand pb-4`，subtab 下面多一条分隔线——Artifact
  //   `.navtabs` 后面直接就是内容卡片，没有这条线，删掉。
  // - `gap-8`(32px) 头部跟正文之间空得太多，Artifact 这一段间距量出来是 14px（`.navtabs`
  //   的 margin-bottom），改成 `gap-3.5`。
  // - 标题+副标题+切换行程+subtab 这一整块现在都在 TripHeaderNav 里（合并了原来的
  //   trip-switcher.tsx + nav-links.tsx，理由见那个文件顶部注释）。
  return (
    <div className="action-bar-reserve flex flex-col gap-3.5">
      <header>
        <TripHeaderNav
          tripId={trip.id}
          tripName={trip.name}
          subtitle={`本位币 ${trip.baseCurrency} · ${TRIP_STATUS_LABEL[trip.status] ?? trip.status}`}
          accountHref={`/account?from=${trip.id}`}
          otherTrips={otherTrips}
          isOwner={identity.isOwner}
          navLinks={navLinks}
        />
      </header>
      {children}
      <RecordExpenseBar tripId={trip.id} />
    </div>
  );
}
