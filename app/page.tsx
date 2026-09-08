import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import { getCurrentIdentity } from '@/lib/auth/current-session';
import { getCurrentUser } from '@/lib/auth/current-user';
import { loadUserTripsWithBalance } from '@/lib/db/user-trips-query';
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
    const db = await getDb();
    // 余额优先原则延伸到列表页：每张行程卡片顺手标一下当前用户在这个行程里的净额，
    // 让"要不要点进去看"提前到列表页就能判断，不用逐个点进去才知道。
    const tripsWithBalance = await loadUserTripsWithBalance(db, user.userId);

    return (
      <main className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-ink">我的行程</h1>
            <p className="mt-1 text-[10px] text-muted">{user.displayName}，欢迎回来。</p>
          </div>
          <Link
            href="/trips/new"
            className="btn-primary"
          >
            创建新行程
          </Link>
        </div>
        <MyTrips trips={tripsWithBalance} />
      </main>
    );
  }

  // ③ 都没有 → 现在这个空首页，两个入口都要求先登录/注册。
  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="text-base font-semibold text-ink">消费记录</h1>
        <p className="mt-2 text-[10px] text-muted">
          出差记账 + 同行人代垫结清 + 汇率比对，帮你算清这笔该用哪张卡最划算。数据只存在你自己部署的服务器上。
        </p>
      </div>
      <Link
        href="/login?next=/trips/new"
        className="btn-primary"
      >
        创建新行程
      </Link>
      <p className="text-[10px] text-muted">
        已经有账号？
        <Link href="/login" className="tap-link ml-1">
          登录
        </Link>
      </p>
      <p className="text-[10px] text-muted">已经有同行人分享给你的邀请链接？直接打开那个链接就能认领身份。</p>
    </main>
  );
}
