'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function handleClick() {
    setSubmitting(true);
    try {
      await fetch('/api/account/logout', { method: 'POST' });
      router.push('/');
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // fix(2026-09-16 第十七轮，独立 ui-auditor 走查抓到的真实漏网点)：这轮把头部
    // "我的账号"链接改成了 Artifact `.account-links{font-size:10.5px} a{underline}`
    // 的规格，但这颗按钮是单独的组件（trip-header-nav.tsx 只负责排版，没管到这个
    // 文件内部的 className），漏改了——之前是 text-[12.5px] 且完全没有下划线，
    // 跟旁边"我的账号"链接明显不一样大、一个有下划线一个没有。这次补齐同一套值。
    <button
      type="button"
      onClick={handleClick}
      disabled={submitting}
      className="inline-flex items-center text-[10.5px] text-muted underline underline-offset-2 hover:text-ink disabled:opacity-50"
    >
      {submitting ? '退出中…' : '退出登录'}
    </button>
  );
}
