import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { AccountIdentityLink } from './account-identity-link';

/**
 * 专属身份链接不能只在开号那一刻展示一次就找不回——这里是随时能回来
 * 查看/复制的地方，TripLayout 头部和首页登录态都链到这里。
 *
 * URL 在服务端算好完整地址再传给客户端组件，不能像之前那样让客户端组件
 * 自己读 `window.location.origin` 拼——服务端渲染时 window 不存在只能先吐
 * 空字符串，客户端 hydrate 时才补上真实链接，两次内容对不上会触发 React
 * hydration mismatch（这轮 ui-auditor 走查抓到的真实回归，`/account` 页面
 * 每次访问必现 9 条 console error）。跟 `/api/account/provision` 路由算
 * `identityUrl` 用的是同一个"host+协议拼绝对地址"的思路，只是那边能拿到
 * `request.url`，这里是 Server Component 用 `headers()` 读 `host`/
 * `x-forwarded-proto`（Cloudflare 经过的请求都会带这个头）。
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

  const requestHeaders = headers();
  const host = requestHeaders.get('host') ?? '';
  const protocol = requestHeaders.get('x-forwarded-proto') ?? 'https';
  const identityUrl = host ? `${protocol}://${host}/id/${row.identityToken}` : `/id/${row.identityToken}`;

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-base font-semibold text-ink">我的账号</h1>
      <AccountIdentityLink url={identityUrl} />
    </main>
  );
}
