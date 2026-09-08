import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import { trips } from '@/lib/db/schema';
import { getCurrentIdentity } from '@/lib/auth/current-session';
import { getCurrentUser } from '@/lib/auth/current-user';
import { loadUserTripsWithBalance } from '@/lib/db/user-trips-query';
import { LogoutButton } from './logout-button';
import { RecordExpenseFab } from './record-expense-fab';
import { TripSwitcher } from './trip-switcher';

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
  // 挪到下面固定在屏幕底部的常驻按钮，单手持机时拇指自然落点就能点到。
  const navLinks = [
    { href: `/trips/${trip.id}`, label: '行程主页' },
    { href: `/trips/${trip.id}/settlement`, label: '结算' },
    { href: `/trips/${trip.id}/payment-methods`, label: '支付方式' },
  ];

  return (
    <div className="flex flex-col gap-8 pb-28">
      <header className="flex flex-col gap-4 border-b border-sand pb-4">
        <div className="flex items-center justify-between">
          <div>
            <TripSwitcher currentTripId={trip.id} currentTripName={trip.name} otherTrips={otherTrips} />
            <p className="text-[10px] text-muted">本位币 {trip.baseCurrency}</p>
          </div>
          <LogoutButton />
        </div>
        <nav className="flex flex-wrap gap-x-4 gap-y-2 text-[12.5px]">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex min-h-[44px] items-center text-muted hover:text-ink hover:underline"
            >
              {link.label}
            </Link>
          ))}
          {identity.isOwner && (
            <Link
              href={`/trips/${trip.id}/invites`}
              className="inline-flex min-h-[44px] items-center text-muted hover:text-ink hover:underline"
            >
              邀请管理
            </Link>
          )}
        </nav>
      </header>
      {children}
      <RecordExpenseFab tripId={trip.id} />
    </div>
  );
}
