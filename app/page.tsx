import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db/client';
import { participants, trips } from '@/lib/db/schema';
import { getCurrentIdentity } from '@/lib/auth/current-session';
import { getCurrentUser } from '@/lib/auth/current-user';
import { MyTrips } from './my-trips';

export default async function HomePage() {
  // ① tel_session 有效 → 跟今天一样直接跳进那个 trip，guest 零摩擦流程原样保留。
  const identity = await getCurrentIdentity();
  if (identity) {
    redirect(`/trips/${identity.tripId}`);
  }

  // ② 否则查 tel_user_session，有效就查这个账号建过/认领过的行程，画"我的行程"列表。
  const user = await getCurrentUser();
  if (user) {
    const rows = await db
      .select({
        id: trips.id,
        name: trips.name,
        baseCurrency: trips.baseCurrency,
        status: trips.status,
        isOwner: participants.isOwner,
      })
      .from(participants)
      .innerJoin(trips, eq(participants.tripId, trips.id))
      .where(eq(participants.userId, user.userId));

    return (
      <main className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">我的行程</h1>
            <p className="mt-1 text-sm text-slate-500">{user.displayName}，欢迎回来。</p>
          </div>
          <Link
            href="/trips/new"
            className="btn-primary"
          >
            创建新行程
          </Link>
        </div>
        <MyTrips trips={rows} />
      </main>
    );
  }

  // ③ 都没有 → 现在这个空首页，两个入口都要求先登录/注册。
  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">消费记录</h1>
        <p className="mt-2 text-slate-600">
          出差记账 + 同行人代垫结清 + 汇率比对，帮你算清这笔该用哪张卡最划算。数据只存在你自己部署的服务器上。
        </p>
      </div>
      <Link
        href="/login?next=/trips/new"
        className="btn-primary"
      >
        创建新行程
      </Link>
      <p className="text-sm text-slate-500">
        已经有账号？
        <Link href="/login" className="tap-link ml-1">
          登录
        </Link>
      </p>
      <p className="text-sm text-slate-500">已经有同行人分享给你的邀请链接？直接打开那个链接就能认领身份。</p>
    </main>
  );
}
