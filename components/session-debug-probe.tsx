'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * ⚠️ 临时诊断组件（round48，排查"任意 trip 子路由快速连续导航后 session 丢失"），
 * 排查结束后应删除——不是长期功能，挂在 root layout 里但默认完全不生效。
 *
 * 只在 URL 带 `?diag=1` 时才做任何事（不 fetch、不监听、不渲染），正常使用
 * 场景下这个组件是纯粹的空操作，不会给 Remy 平时用的页面增加任何请求/开销。
 *
 * 干两件事，对应"根因是真丢 cookie 还是渲染读旧态"这条判断链：
 * ① 每次 mount + 每次 `pageshow` 事件时，打一次 /api/debug/session-probe——
 *    这个请求绕不开服务端 cookie 的真实状态（不会被 Next.js Router Cache 短路，
 *    因为这是普通 fetch，不是页面导航）。
 * ② 记录 `pageshow` 的 `event.persisted`——`true` 代表这次页面是浏览器 bfcache
 *    整页恢复出来的（没有重新跑 hydration/服务端渲染），`false` 是正常加载/客户端
 *    路由切换。这能区分"bfcache 恢复了旧 DOM 快照"还是别的机制。
 *
 * 结果只 console.log（配合 wrangler tail 时间戳对表，走查用 browser_console_messages
 * 读），不画屏幕浮层——这个项目对"贴角贴底的 fixed 悬浮控件"有专门的结构守护
 * （record-expense-bar.test.ts②，三轮真实遮挡事故换来的），临时诊断组件不该
 * 为了可视化去踩这条线，console 已经够读取证据。
 */
export function SessionDebugProbe() {
  const searchParams = useSearchParams();
  const enabled = searchParams?.get('diag') === '1';

  useEffect(() => {
    if (!enabled) return;

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

    probe('mount');

    function onPageShow(e: PageTransitionEvent) {
      console.log(`[diag] pageshow persisted=${e.persisted} path=${location.pathname} t=${Date.now()}`);
      probe(`pageshow-persisted-${e.persisted}`);
    }
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [enabled]);

  return null;
}
