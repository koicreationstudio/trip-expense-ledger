import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db/client';
import { trips } from '@/lib/db/schema';
import { getCurrentIdentity } from '@/lib/auth/current-session';
import { LogoutButton } from './logout-button';

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

  const trip = await db.query.trips.findFirst({ where: eq(trips.id, params.tripId) });
  if (!trip) {
    redirect('/');
  }

  const navLinks = [
    { href: `/trips/${trip.id}`, label: '行程主页' },
    { href: `/trips/${trip.id}/expenses/new`, label: '记一笔' },
    { href: `/trips/${trip.id}/settlement`, label: '结算' },
    { href: `/trips/${trip.id}/payment-methods`, label: '支付方式' },
  ];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">{trip.name}</p>
            <p className="text-xs text-slate-500">本位币 {trip.baseCurrency}</p>
          </div>
          <LogoutButton />
        </div>
        <nav className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href} className="text-slate-600 hover:text-slate-900 hover:underline">
              {link.label}
            </Link>
          ))}
          {identity.isOwner && (
            <Link
              href={`/trips/${trip.id}/invites`}
              className="text-slate-600 hover:text-slate-900 hover:underline"
            >
              邀请管理
            </Link>
          )}
        </nav>
      </header>
      {children}
    </div>
  );
}
