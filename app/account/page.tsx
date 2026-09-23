import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { BUILD_COMMIT, BUILD_TIME } from '@/lib/build-info';
import { AccountIdentityLink } from './account-identity-link';
import { SetPinForm } from './set-pin-form';
import { HardRefreshButton } from './hard-refresh-button';

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
 *
 * fix(2026-09-12 死路走查)：这页进来之后原本没有任何返回/退出控件，只能靠
 * 浏览器物理返回键离开（Remy 实测抓到的问题）。这页本身没有 tripId 上下文
 * （getCurrentUser() 拿的是账号级信息），没法直接知道"该回哪个行程"——
 * 靠链接来源自己带 `?from=<tripId>` 传过来（TripLayout 头部"我的账号"链接
 * 已经带了），带了就退回那个行程主页，没带（比如直接从首页点进来，或者
 * 直接输网址访问）就退回首页，两种情况都是"回到明确知道能到哪的地方"，
 * 不去校验 from 是不是当前身份能访问的行程——`/trips/[tripId]` 自己那层
 * `getCurrentIdentity()` 鉴权会兜底，对不上会自己再跳回首页，这里不用重复判断。
 */
export default async function AccountPage({ searchParams }: { searchParams?: { from?: string } }) {
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

  const backHref = searchParams?.from ? `/trips/${searchParams.from}` : '/';
  const backLabel = searchParams?.from ? '返回行程' : '返回首页';

  // 部署时间统一按马来西亚时区(UTC+8)显示，跟 Remy 自己看时间的习惯对齐，
  // 不用她再心算 UTC 时间戳换算。BUILD_TIME/BUILD_COMMIT 是
  // scripts/generate-build-info.mjs 在上一次 `npm run build`（deploy.sh
  // 部署那一刻）写实的值，不是运行时现算，Cloudflare Workers 运行时环境
  // 没有 .git 目录读不到 git 信息。
  const deployedAtLabel = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(BUILD_TIME));

  return (
    // fix(2026-09-16 第十七轮)：gap-6(24px) 收到 gap-3.5(14px)，理由同 settlement/page.tsx。
    <main className="flex flex-col gap-3.5">
      <Link href={backHref} className="tap-link self-start text-[10px] text-muted hover:text-ink">
        ← {backLabel}
      </Link>
      {/* fix(2026-09-18，第二十六轮全量复核)：Artifact `.title-block h3{font-weight:700}`
          全站统一，行程内四屏（TripHeaderNav）早就是 font-bold(700)，这个独立页面漏在
          font-semibold(600)，round26 实测才抓到这个跨屏字重不一致，改成 font-bold。 */}
      <h1 className="text-[15px] font-bold text-ink">我的账号</h1>
      <AccountIdentityLink url={identityUrl} />
      <SetPinForm hasPinSet={Boolean(row.recoveryPinHash)} />
      <HardRefreshButton />
      <p className="text-[8.5px] text-muted">
        版本 {BUILD_COMMIT} · 部署于 {deployedAtLabel}（UTC+8）
      </p>
    </main>
  );
}
