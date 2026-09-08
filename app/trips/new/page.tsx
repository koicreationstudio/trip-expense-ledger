import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/current-user';
import { NewTripForm } from './new-trip-form';

/**
 * 建行程要求先登录——这是"创建者必须有账号"这条设计原则的落地点。
 * 没有 tel_user_session 就跳 /login?next=/trips/new，登录/注册完回到这里继续建行程。
 */
export default async function NewTripPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login?next=/trips/new');
  }

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-base font-semibold text-ink">创建新行程</h1>
      <NewTripForm />
    </main>
  );
}
