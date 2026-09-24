'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * ⚠️ 临时诊断组件（round48，排查"任意 trip 子路由快速连续导航后 session 丢失"），
 * 排查结束后应删除——不是长期功能，挂在 root layout 里但默认完全不生效。
 *
 * 只在 URL 带过 `?diag=1`（一次即可，之后用 sessionStorage 记住，这个 tab
 * 后续任何客户端路由跳转不会丢这个标记）才做任何事，正常使用场景下这个组件
 * 完全是空操作，不给 Remy 平时用的页面增加任何请求/开销。
 *
 * 关键设计决定：这个组件挂在 root layout（`app/layout.tsx`）里，Next.js App
 * Router 的 root layout 在客户端路由导航时**不会**重新挂载（这正是布局能保持
 * 导航栏之类持久 UI 状态的机制），所以这个组件本身的存活不受 Router Cache
 * 影响——不管 `{children}` 那块内容是不是服务器新渲染的还是缓存里挖出来的旧
 * RSC payload，这个组件的 `usePathname()`/`useSearchParams()` 读到的永远是
 * 浏览器地址栏当下的真实 URL，探测请求打的也是当下真实的 cookie。这让它能
 * 回答"这一刻 cookie 到底有没有失效"，跟画面上（可能是缓存出来的旧渲染）
 * 显示的内容互相独立验证，用来区分"cookie 真丢了"还是"页面读到了旧状态"。
 *
 * 干两件事：
 * ① 每次 pathname/searchParams 变化（覆盖 router.push 客户端导航 + 浏览器
 *    地址栏变化）+ 每次 `pageshow` 事件（覆盖硬导航/bfcache 整页恢复），
 *    打一次 /api/debug/session-probe——这个请求是普通 fetch，不是页面导航，
 *    不会被 Next.js Router Cache 短路，服务端每次都真的查一次 D1。
 * ② 记录 `pageshow` 的 `event.persisted`——`true` 代表这次页面是浏览器 bfcache
 *    整页恢复出来的（没有重新跑 hydration/服务端渲染），能区分"bfcache 恢复了
 *    旧的整页快照"还是别的机制。
 *
 * 结果只 console.log（配合 wrangler tail 时间戳对表，走查用 browser_console_messages
 * 读），不画屏幕浮层——这个项目对"贴角贴底的 fixed 悬浮控件"有专门的结构守护
 * （record-expense-bar.test.ts②，三轮真实遮挡事故换来的），临时诊断组件不该
 * 为了可视化去踩这条线，console 已经够读取证据。
 */
const STORAGE_KEY = 'tel_diag_enabled';

function isEnabled(searchParams: URLSearchParams | null): boolean {
  if (searchParams?.get('diag') === '1') {
    try {
      sessionStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // sessionStorage 不可用（隐私模式等）时退化成"只在带参数的这一次生效"，不阻断。
    }
    return true;
  }
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function probe(trigger: string) {
  const t0 = Date.now();
  fetch('/api/debug/session-probe', { cache: 'no-store' })
    .then((r) => r.json() as Promise<{ hasSessionCookie: boolean; hasUserCookie: boolean; identity: unknown; user: unknown }>)
    .then((data) => {
      console.log(
        `[diag] trigger=${trigger} path=${location.pathname} sessionCookie=${data.hasSessionCookie} userCookie=${data.hasUserCookie} identity=${JSON.stringify(data.identity)} user=${JSON.stringify(data.user)} t=${t0}`
      );
    })
    .catch((e) => {
      console.log(`[diag] trigger=${trigger} path=${location.pathname} probe-error=${String(e)} t=${t0}`);
    });
}

export function SessionDebugProbe() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!isEnabled(searchParams)) return;
    const qs = searchParams?.toString();
    probe(`nav:${pathname}${qs ? `?${qs}` : ''}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams?.toString()]);

  useEffect(() => {
    function onPageShow(e: PageTransitionEvent) {
      if (!isEnabled(searchParams)) return;
      console.log(`[diag] pageshow persisted=${e.persisted} path=${location.pathname} t=${Date.now()}`);
      probe(`pageshow-persisted-${e.persisted}`);
    }
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
