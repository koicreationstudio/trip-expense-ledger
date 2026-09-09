'use client';

import { useState } from 'react';

export function AccountIdentityLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== 'undefined' ? `${window.location.origin}/id/${token}` : '';

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板权限拿不到就算了，链接本来就显示在页面上，用户可以自己选中复制
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <p className="text-[10px] text-muted">
        这条链接是你重新登录这个账号唯一的方式，没有邮箱密码。换设备、清了浏览器数据时，打开这条链接就能回来。
      </p>
      <div className="flex flex-col gap-2 rounded-xl border border-sand bg-[#EDE8DA]/35 px-[9px] py-[9px] shadow-card">
        <code className="break-all font-mono text-xs text-ink">{url}</code>
        <button type="button" onClick={handleCopy} className="btn-secondary self-start shrink-0 whitespace-nowrap">
          {copied ? '已复制' : '复制链接'}
        </button>
      </div>
    </section>
  );
}
