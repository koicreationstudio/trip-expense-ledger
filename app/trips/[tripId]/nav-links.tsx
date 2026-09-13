'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * fix(2026-09-14 Artifact Version 10 走查补做)：Version 10 里当前所在的 tab（行程主页/
 * 结算/支付方式/邀请管理）是深色实底 pill，跟其它三个纯文字链接明显区分——之前 layout.tsx
 * 里这排链接全部共用同一个 class，没有按当前路径判断高亮。要拿到"当前路径"就得用
 * usePathname()（客户端 hook），所以把这排 <nav> 拆成一个小客户端组件，links 数据还是从
 * layout.tsx（服务端组件）算好传进来，不在这里重新拼 href。
 */
export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-x-4 gap-y-2 text-[10.5px]">
      {links.map((link) => {
        const isActive = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={
              isActive
                ? 'tap-link rounded-full bg-ink px-[10px] font-medium text-white'
                : 'tap-link text-muted hover:text-ink'
            }
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
