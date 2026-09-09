import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { AccountIdentityLink } from './account-identity-link';

/**
 * 专属身份链接不能只在开号那一刻展示一次就找不回——这里是随时能回来
 * 查看/复制的地方，TripLayout 头部和首页登录态都链到这里。
 */
export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/');
  }

  const db = await getDb();
  const row = await db.query.users.findFirst({ where: eq(users.id, user.userId) });
  if (!row?.identityToken) {
    // 理论上不该发生（开号那一刻一定写了 identityToken），兜底避免整页挂掉
    redirect('/');
  }

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-base font-semibold text-ink">我的账号</h1>
      <AccountIdentityLink token={row.identityToken} />
    </main>
  );
}
