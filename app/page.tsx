import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentIdentity } from '@/lib/auth/current-session';

export default async function HomePage() {
  const identity = await getCurrentIdentity();
  if (identity) {
    redirect(`/trips/${identity.tripId}`);
  }

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">消费记录</h1>
        <p className="mt-2 text-slate-600">
          出差记账 + 同行人代垫结清 + 汇率比对，帮你算清这笔该用哪张卡最划算。数据只存在你自己部署的服务器上。
        </p>
      </div>
      <Link
        href="/trips/new"
        className="inline-flex w-fit items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
      >
        创建新行程
      </Link>
      <p className="text-sm text-slate-500">已经有同行人分享给你的邀请链接？直接打开那个链接就能认领身份。</p>
    </main>
  );
}
