'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * round48 根因修复：浏览器后退/前进（`popstate`）在 Next.js 14 App Router 下会
 * 无条件命中客户端 Router Cache 里的旧渲染——独立 ui-auditor 用 Remy 真实行程
 * 「🇭🇰2026香港」复测「后退再进」这一类路径，5/5 次 100% 复现同一个模式：URL 和
 * 主内容都正确切回上一屏，但挂在 trip 布局（`app/trips/[tripId]/layout.tsx`）
 * 里的 `TripHeaderNav` 顶部导航高亮没跟着切，停在后退前离开的那个子页——`[diag]`
 * 日志确认这几次 cookie/identity 全程有效，不是 session 问题，是纯粹的客户端
 * 渲染没跟上真实 URL。
 *
 * 这跟 round44/47 已经补的 `router.refresh()` 是两类不同的场景：那批修复补的是
 * "先打 API 换 session、再 push 导航"这几个入口（点行程卡片/认领邀请/切换行程/
 * 退出登录），这里是纯粹的浏览器历史导航（用户按物理/手势后退键），根本不经过
 * 那些业务代码里的 push/refresh 调用，`popstate` 事件才是唯一能挂上的钩子。
 *
 * 修法：监听 `popstate`（只有真实的浏览器历史导航才会派发这个事件，本站内部
 * `router.push`/`<Link>` 触发的导航不会），触发时强制 `router.refresh()` 一次，
 * 让当前这一屏重新走一次真实服务端渲染，不再信任 Router Cache 里可能过期的
 * 旧渲染。全局只需要挂一个监听器，放在 root layout（跟 `SessionDebugProbe`
 * 同级）。
 *
 * **诚实边界（round48 如实记录，别夸大这个修复的确定性）**：这次复测还发现了
 * 两类更严重、目前没搞清楚机制的现象——①至少 2 次完全没有用户操作却发生的
 * 自动跳转（比如落地行程主页后 9.7 秒自己跳到结算页，服务端日志证实 cookie/
 * identity 全程有效，不是 session 问题，但也不是这个 popstate 监听器能解释或
 * 修到的范围，没有找到对应的应用层代码触发点）②一次伴随浏览器 `about:blank`
 * 异常事件之后，服务端日志显示 `identity=null` 且 `user=null`（cookie 真的没
 * 被识别，不是渲染假象）——这次没能确定这是真实的 app/session 缺陷还是测试用
 * Playwright 浏览器环境本身的问题，这次修复**不针对**这两类现象，PENDING-
 * DECISIONS 会如实标注为未解决，留给下一轮专门排查。
 */
export function PopstateRefresh() {
  const router = useRouter();

  useEffect(() => {
    function onPopState() {
      router.refresh();
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [router]);

  return null;
}
