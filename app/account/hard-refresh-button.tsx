'use client';

import { RefreshCw } from 'lucide-react';
import { useState } from 'react';

/**
 * "强刷更新"按钮 —— 2026-09-15 加，动机不是技术上真的有缓存卡住内容（核实
 * 过：这个项目所有页面/API 走 `cache-control: private, no-cache, no-store,
 * max-age=0, must-revalidate`，没有 service worker、没有 PWA manifest，
 * `_next/static` 那批带 hash 文件名的资源长缓存是正常的，文件名本身随内容
 * 变化，不需要强刷），而是 Remy 连续几轮怀疑"我看到的是不是最新版本"，这个
 * 按钮给她一个可以自己按、立刻心安的动作。
 *
 * 真正起作用的只有最后的 `window.location.reload()`（浏览器级硬刷新，绕开
 * Next.js App Router 的客户端 Router Cache，比 `router.refresh()` 更彻底）。
 * 前面 unregister service worker / 清 Cache Storage 这两步现在必定是空操作
 * （上面说了，这个项目现在没有这两样东西），留着是防万一以后哪天加了 PWA
 * 离线支持又忘了教这个按钮怎么清，不算防御过度。
 */
export function HardRefreshButton() {
  const [refreshing, setRefreshing] = useState(false);

  async function handleHardRefresh() {
    setRefreshing(true);
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
      if ('caches' in window) {
        const cacheKeys = await caches.keys();
        await Promise.all(cacheKeys.map((key) => caches.delete(key)));
      }
    } catch {
      // 清理失败也不影响下面的强制刷新，这两步本来就是"以防万一"
    } finally {
      window.location.reload();
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <p className="text-[10px] text-muted">不确定看到的是不是最新内容？点这个直接跟服务器重新要一份，不会用本地缓存的旧内容。</p>
      <button
        type="button"
        onClick={handleHardRefresh}
        disabled={refreshing}
        className="btn-secondary self-start gap-[5px]"
      >
        <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
        {refreshing ? '刷新中…' : '强制刷新最新版本'}
      </button>
    </section>
  );
}
