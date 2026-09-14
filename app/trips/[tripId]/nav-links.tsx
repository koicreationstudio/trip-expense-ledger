'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * fix(2026-09-14 Artifact Version 10 走查补做)：Version 10 里当前所在的 tab（行程主页/
 * 结算/支付方式/邀请管理）是深色实底 pill，跟其它三个纯文字链接明显区分——之前 layout.tsx
 * 里这排链接全部共用同一个 class，没有按当前路径判断高亮。要拿到"当前路径"就得用
 * usePathname()（客户端 hook），所以把这排 <nav> 拆成一个小客户端组件，links 数据还是从
 * layout.tsx（服务端组件）算好传进来，不在这里重新拼 href。
 *
 * fix(2026-09-14 第四轮走查，Artifact `.navtabs` 逐值核对)：Artifact 这排 tab 外面还包了
 * 一层浅金色圆角"轨道"（background: gold-lt、border-radius: 999px、padding: 3px、
 * gap: 4px、宽度贴内容），当前 tab 是黑色实心小胶囊嵌在轨道里——之前只做出了黑色胶囊，
 * 没有这层轨道容器，四个 tab 看起来是散的。补上这层 <div> 包装，其它三个链接维持纯文字。
 */
export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex w-fit flex-wrap gap-1 rounded-full bg-gold-lt p-[3px] text-[10.5px]">
      {links.map((link) => {
        const isActive = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={
              isActive
                ? 'tap-link rounded-full bg-ink px-[10px] font-medium text-white'
                : 'tap-link px-[10px] text-gold-dk hover:text-ink'
            }
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
