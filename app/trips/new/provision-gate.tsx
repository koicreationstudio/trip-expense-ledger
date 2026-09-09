'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 第一次进 /trips/new 且没有账号：先自动开号拿到专属身份链接，要求确认
 * "已保存"才继续填行程表单——这条链接是以后重新登录唯一的入口（没有邮箱
 * 密码），展示一次容易弄丢，所以除了这里，/account 页面随时能再看一次。
 */
export function ProvisionGate() {
  const router = useRouter();
  const [identityUrl, setIdentityUrl] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setError(null);
    setProvisioning(true);
    try {
      const res = await fetch('/api/account/provision', { method: 'POST' });
      if (!res.ok) {
        setError('开号失败，刷新页面再试一次');
        return;
      }
      const data = (await res.json()) as { alreadyProvisioned: boolean; identityUrl?: string };
      if (data.alreadyProvisioned) {
        router.refresh();
        return;
      }
      setIdentityUrl(data.identityUrl ?? null);
    } finally {
      setProvisioning(false);
    }
  }

  async function handleCopy() {
    if (!identityUrl) return;
    try {
      await navigator.clipboard.writeText(identityUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板权限拿不到就算了，链接本来就显示在页面上，用户可以自己选中复制
    }
  }

  if (identityUrl) {
    return (
      <main className="flex flex-col gap-6">
        <div>
          <h1 className="text-base font-semibold text-ink">保存好你的专属身份链接</h1>
          <p className="mt-2 text-[10px] text-muted">
            这条链接是你以后唯一能重新登录这个账号的方式——没有邮箱密码，链接丢了就找不回账号。建议现在复制存到备忘录或密码管理器，之后随时能在&ldquo;我的账号&rdquo;页面里再看一次。
          </p>
        </div>
        <div className="flex flex-col gap-2 rounded-xl border border-sand bg-[#EDE8DA]/35 px-[9px] py-[9px] shadow-card">
          <code className="break-all font-mono text-xs text-ink">{identityUrl}</code>
          <button type="button" onClick={handleCopy} className="btn-secondary self-start shrink-0 whitespace-nowrap">
            {copied ? '已复制' : '复制链接'}
          </button>
        </div>
        <button type="button" onClick={() => router.refresh()} className="btn-primary">
          我已保存，继续创建行程
        </button>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="text-base font-semibold text-ink">创建新行程</h1>
        <p className="mt-2 text-[10px] text-muted">第一次建行程要先帮你建一个专属身份，不需要邮箱密码，几秒钟就好。</p>
      </div>
      {error && <p className="text-sm text-coral">{error}</p>}
      <button type="button" onClick={handleStart} disabled={provisioning} className="btn-primary">
        {provisioning ? '开号中…' : '开始'}
      </button>
    </main>
  );
}
