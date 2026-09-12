'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { extractIdentityToken } from '@/lib/domain/identity-recovery';

/**
 * 第一次进 /trips/new 且没有账号：先自动开号拿到专属身份链接，要求确认
 * "已保存"才继续填行程表单——这条链接是以后重新登录唯一的入口（没有邮箱
 * 密码），展示一次容易弄丢，所以除了这里，/account 页面随时能再看一次。
 *
 * 2026-09-12 加安全网（第一版，轻量实现，还没接邮箱找回）：查不到账号
 * 不能再默认当"新用户"直接开号——iOS"添加到主屏幕"每加一个图标都是一次
 * 独立的存储空间，从系统角度看就是"新设备"，不堵住这个口子会反复重演
 * "同一个人被拆成好几个账号"（2026-09 曼谷行程分裂成两个账号就是这么来的）。
 * 所以查不到账号先停在 'ask' 这一步，明确问清楚是不是老用户，只有用户自己
 * 选"我是新用户"才走原本的开号流程；选"我有身份链接"就地粘贴恢复，
 * 复用现成的 /id/[token] 登录路由，不重新发明验证逻辑。
 */
type Step = 'ask' | 'recover' | 'result';

export function ProvisionGate() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('ask');
  const [identityUrl, setIdentityUrl] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pastedLink, setPastedLink] = useState('');
  const [recoverError, setRecoverError] = useState<string | null>(null);

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
      setStep('result');
    } finally {
      setProvisioning(false);
    }
  }

  function handleRecoverSubmit() {
    const token = extractIdentityToken(pastedLink);
    if (!token) {
      setRecoverError('看起来不是一条有效的身份链接，检查一下有没有复制完整');
      return;
    }
    // 直接跳到现成的登录路由，对不对得上由那边判断（token 无效会跳回首页
    // 带 identity_invalid=1，不在这里重复实现校验逻辑）。
    window.location.href = `/id/${token}`;
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

  if (step === 'ask') {
    return (
      <main className="flex flex-col gap-6">
        {/* fix(2026-09-12 死路走查)：这一步没有账号，还没走到"建行程"这个动作本身，
            改主意想先回首页看看（比如想找找有没有身份链接/邀请链接）应该随时能走，
            不用被卡在这一步只能物理返回键。 */}
        <Link href="/" className="tap-link self-start text-[10px] text-muted hover:text-ink">
          ← 返回首页
        </Link>
        <div>
          <h1 className="text-base font-semibold text-ink">先确认一下</h1>
          <p className="mt-2 text-[10px] text-muted">
            这个浏览器/设备还没有登录记录。如果你之前已经用过这个工具（比如换了手机、换了浏览器，或者是新加的
            &ldquo;添加到主屏幕&rdquo;图标），继续下去会建一个全新的、跟你原本行程对不上的账号。
          </p>
        </div>
        <button type="button" onClick={() => setStep('recover')} className="btn-secondary">
          我有专属身份链接，去恢复账号
        </button>
        {error && <p className="text-[10px] text-coral">{error}</p>}
        <button type="button" onClick={handleStart} disabled={provisioning} className="btn-primary">
          {provisioning ? '开号中…' : '我是新用户，直接开始'}
        </button>
      </main>
    );
  }

  if (step === 'recover') {
    return (
      <main className="flex flex-col gap-6">
        <div>
          <h1 className="text-base font-semibold text-ink">粘贴你的专属身份链接</h1>
          <p className="mt-2 text-[10px] text-muted">
            开号那一刻展示过一次，格式类似 .../id/一串随机字符。存在备忘录、聊天记录或者发给自己的邮件里的话，
            找出来贴在下面就行，贴完整链接或者只贴那串字符都可以。
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="identity-recover-input" className="field-label">
            身份链接
          </label>
          <input
            id="identity-recover-input"
            type="text"
            className="field-input"
            placeholder="https://.../id/xxxxx 或者直接贴那串字符"
            value={pastedLink}
            onChange={(e) => {
              setPastedLink(e.target.value);
              setRecoverError(null);
            }}
          />
        </div>
        {recoverError && <p className="text-[10px] text-coral">{recoverError}</p>}
        <button type="button" onClick={handleRecoverSubmit} className="btn-primary">
          用这条链接登录
        </button>
        <button type="button" onClick={() => setStep('ask')} className="btn-secondary">
          返回
        </button>
      </main>
    );
  }

  if (step === 'result' && identityUrl) {
    return (
      <main className="flex flex-col gap-6">
        <div>
          <h1 className="text-base font-semibold text-ink">保存好你的专属身份链接</h1>
          <p className="mt-2 text-[10px] text-muted">
            这条链接是你以后唯一能重新登录这个账号的方式——没有邮箱密码，链接丢了就找不回账号。建议现在复制存到备忘录或密码管理器，之后随时能在&ldquo;我的账号&rdquo;页面里再看一次。
          </p>
        </div>
        <div className="flex flex-col gap-2 rounded-xl border border-sand bg-[rgba(164,163,160,.14)] px-[9px] py-[9px] shadow-card">
          <code className="break-all font-mono text-xs text-ink">{identityUrl}</code>
          <button type="button" onClick={handleCopy} className="btn-secondary self-start shrink-0 whitespace-nowrap">
            {copied ? '已复制' : '复制链接'}
          </button>
        </div>
        <button type="button" onClick={() => router.refresh()} className="btn-primary">
          我已保存，继续创建行程
        </button>
        {/* fix(2026-09-12 死路走查)：这一步账号其实已经开好了（handleStart 那次
            POST /api/account/provision 已经写进数据库），"我已保存，继续创建行程"
            只是确认闸门，不是必须马上点的强制步骤——不想现在就建行程也能先离开，
            这条链接之后随时能在"我的账号"页面重新看到，不会因为跳走而丢失。
            故意做成弱化的次级文字链接（不是 btn-secondary），不跟上面的主按钮
            抢视觉重量，避免看起来像"两个都能选的平级选项"淡化了先复制保存这件事。 */}
        <Link href="/" className="tap-link self-start text-[10px] text-muted hover:text-ink">
          稍后再建，先返回首页
        </Link>
      </main>
    );
  }

  // 'result' 步骤但 identityUrl 还没写进 state 的中间态（理论上不会停在这里，
  // handleStart 成功一定会带着 identityUrl 才切到 'result'），兜底别让页面空白。
  return null;
}
