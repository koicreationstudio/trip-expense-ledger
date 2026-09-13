import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import { trips } from '@/lib/db/schema';
import { getCurrentIdentity } from '@/lib/auth/current-session';
import { getCurrentUser } from '@/lib/auth/current-user';
import { loadUserTripsWithBalance } from '@/lib/db/user-trips-query';
import { LogoutButton } from './logout-button';
import { RecordExpenseBar } from './record-expense-bar';
import { TripSwitcher } from './trip-switcher';
import { NavLinks } from './nav-links';

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
  if (!identity || identity.tripId !== params.tripId) {
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
  return (
    <div className="action-bar-reserve flex flex-col gap-8">
      <header className="flex flex-col gap-4 border-b border-sand pb-4">
        {/* fix(2026-09-14 Artifact Version 10 走查补做)：Version 10 头部是"大标题+独立胶囊"
            两层——trip-switcher.tsx 2026-09-13 那次改动的注释里就写明了"这次没有擅自加"，
            这里补上。左边是静态大标题（跟"记一笔消费"那批页面 h1 同款 text-base
            font-semibold）+ 本位币小字；右边"我的账号/退出登录"占一行，TripSwitcher
            胶囊单独占下一行、右对齐，不再兼职当标题用。 */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold text-ink">{trip.name}</h1>
            <p className="text-[10px] text-muted">本位币 {trip.baseCurrency}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-3">
              {/* fix(2026-09-12 死路走查)：带上 ?from=当前行程id，让 /account 页面知道
                  「回去」应该回哪——账号页本身没有 tripId 上下文（getCurrentUser() 是账号级，
                  不是行程级），只能靠链接来源自己传，account/page.tsx 读不到就退回首页。 */}
              <Link
                href={`/account?from=${trip.id}`}
                className="text-[10px] text-muted hover:text-ink hover:underline"
              >
                我的账号
              </Link>
              <LogoutButton />
            </div>
            <TripSwitcher
              currentTripId={trip.id}
              currentTripName={trip.name}
              otherTrips={otherTrips}
              isOwner={identity.isOwner}
            />
          </div>
        </div>
        {/* fix(2026-09-12 字号走查)：这几个是次级导航链接，不是分节标题，之前用
            text-[12.5px]（DESIGN-SYSTEM-INTERNAL.md「强调/小标题/卡片标题」这一档）偏大，
            跟"参与者"/"活动流"这类真正的区块标题长得一样大分不出主次。改用同一份阶梯里
            低一档的「正文基准」10.5px（Remy 反馈"还是没变小"，历史提交记录里这个 class
            从 331159d 引入起就一直是 12.5px，没有被真的调小过）。
            fix(2026-09-12 触控高度走查)：这几个是纯文字链接，不是独立按钮块，之前手写
            min-h-[44px] 是 DESIGN-BRIEF.md 第四版补丁明确推翻的旧规则（"次要按钮/纯文字
            链接沿用主 CTA 同款 44px"），全站其它纯文字链接早就走 .tap-link(min-h-32px)
            这个 chokepoint，这里当初手写 class 没接上，漏成了孤例。改用 .tap-link，
            触控高度回到跟"查看结算明细→"/"取消"这批文字链接一致的 32px。
            fix(2026-09-14 Artifact Version 10 走查补做)：当前所在的 tab 之前跟其它三个
            纯文字链接长一个样，分不清"我在哪一页"。拆到 NavLinks 客户端组件用
            usePathname() 判断，当前项换成深色实底 pill（跟 fx-channel-compare-card.tsx
            目标币种按钮同款 bg-ink text-white），其它维持纯文字。 */}
        <NavLinks links={navLinks} />
      </header>
      {children}
      <RecordExpenseBar tripId={trip.id} />
    </div>
  );
}
