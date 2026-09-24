'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { extractIdentityToken } from '@/lib/domain/identity-recovery';
import { ConfirmDialog } from '@/components/confirm-dialog';

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
 *
 * 2026-09-23 加第二层摩擦（第一版安全网挡不住的真实事故：Remy 换设备/清了
 * cookie 后确实卡在这一步，但因为手边没有存好身份链接，还是点了"我是新用户，
 * 直接开始"，2026-09 曼谷账号又分裂出一个香港账号，两笔真实行程各挂各的账号，
 * 靠人工查 D1 合并才发现——第一版只是"停下来问一句"，点了确认就直接开号，
 * 没有再多一道"你确定"的关卡）。这次给"我是新用户，直接开始"这颗按钮补一道
 * 二次确认弹窗，文案直接把后果说清楚，逼这个人多想一秒，不是纯装饰性摩擦。
 * 没有做、也做不到的事：这道确认拦不住"这个人真心以为自己没用过"的情况——
 * 那种情况下需要的是邮箱找回这类跨设备的身份找回机制（Remy 已经原则拍板要做，
 * 卡在评估发信服务成本这一步，团队看板 id=2026-09-12_150825_835d7093），
 * 这轮没有动，不属于这次数据修复任务的范围。
 */
type Step = 'ask' | 'recover' | 'pin-recover' | 'result';

export function ProvisionGate() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('ask');
  const [identityUrl, setIdentityUrl] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pastedLink, setPastedLink] = useState('');
  const [recoverError, setRecoverError] = useState<string | null>(null);
  const [confirmingNewAccount, setConfirmingNewAccount] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinRecovering, setPinRecovering] = useState(false);
  const [pinRecoverError, setPinRecoverError] = useState<string | null>(null);

  async function handleStart() {
    setConfirmingNewAccount(false);
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

  async function handlePinRecoverSubmit() {
    setPinRecoverError(null);
    setPinRecovering(true);
    try {
      const res = await fetch('/api/account/recover-pin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin: pinInput }),
      });
      if (res.status === 429) {
        setPinRecoverError('试太多次了，等 15 分钟再试');
        return;
      }
      if (!res.ok) {
        setPinRecoverError('密码/PIN 不对，或者还没设过——没设过的话用身份链接找回');
        return;
      }
      router.refresh();
    } finally {
      setPinRecovering(false);
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

  if (step === 'ask') {
    return (
      <main className="flex flex-col gap-3.5">
        {/* fix(2026-09-12 死路走查)：这一步没有账号，还没走到"建行程"这个动作本身，
            改主意想先回首页看看（比如想找找有没有身份链接/邀请链接）应该随时能走，
            不用被卡在这一步只能物理返回键。 */}
        <Link href="/" className="tap-link self-start text-[10px] text-muted hover:text-ink">
          ← 返回首页
        </Link>
        <div>
          {/* fix(2026-09-16 第十七轮)：16px(text-base)→15px，跟本站其它屏标题规格统一。 */}
          <h1 className="text-[15px] font-semibold text-ink">先确认一下</h1>
          <p className="mt-2 text-[10px] text-muted">
            这个浏览器/设备还没有登录记录。如果你之前已经用过这个工具（比如换了手机、换了浏览器，或者是新加的
            &ldquo;添加到主屏幕&rdquo;图标），继续下去会建一个全新的、跟你原本行程对不上的账号。
          </p>
        </div>
        <button type="button" onClick={() => setStep('recover')} className="btn-secondary">
          我有专属身份链接，去恢复账号
        </button>
        <button type="button" onClick={() => setStep('pin-recover')} className="btn-secondary">
          我设过密码/PIN，直接找回
        </button>
        {error && <p className="text-[10px] text-coral">{error}</p>}
        <button
          type="button"
          onClick={() => setConfirmingNewAccount(true)}
          disabled={provisioning}
          className="btn-primary"
        >
          {provisioning ? '开号中…' : '我是新用户，直接开始'}
        </button>
        <ConfirmDialog
          open={confirmingNewAccount}
          message="确定吗？如果你以前用这个工具记过账、只是暂时找不到身份链接了，现在开新号不会自动带出你以前的行程——之后想合并需要人工处理。真的是第一次用才继续。"
          confirmLabel="确定，开新账号"
          variant="danger"
          onConfirm={handleStart}
          onCancel={() => setConfirmingNewAccount(false)}
        />
      </main>
    );
  }

  if (step === 'recover') {
    return (
      <main className="flex flex-col gap-3.5">
        <div>
          <h1 className="text-[15px] font-semibold text-ink">粘贴你的专属身份链接</h1>
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

  if (step === 'pin-recover') {
    return (
      <main className="flex flex-col gap-3.5">
        <div>
          <h1 className="text-[15px] font-semibold text-ink">输入你的密码/PIN</h1>
          <p className="mt-2 text-[10px] text-muted">
            之前在&ldquo;我的账号&rdquo;页面设过的那个密码/PIN，对上了就直接帮你登进原来的账号。
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="pin-recover-input" className="field-label">
            密码/PIN
          </label>
          <input
            id="pin-recover-input"
            type="password"
            inputMode="numeric"
            className="field-input"
            placeholder="至少 4 位"
            value={pinInput}
            onChange={(e) => {
              setPinInput(e.target.value);
              setPinRecoverError(null);
            }}
          />
        </div>
        {pinRecoverError && <p className="text-[10px] text-coral">{pinRecoverError}</p>}
        <button
          type="button"
          onClick={handlePinRecoverSubmit}
          disabled={pinRecovering || !pinInput}
          className="btn-primary"
        >
          {pinRecovering ? '找回中…' : '用这个密码/PIN 登录'}
        </button>
        <button type="button" onClick={() => setStep('ask')} className="btn-secondary">
          返回
        </button>
      </main>
    );
  }

  if (step === 'result' && identityUrl) {
    return (
      <main className="flex flex-col gap-3.5">
        <div>
          <h1 className="text-[15px] font-semibold text-ink">保存好你的专属身份链接</h1>
          <p className="mt-2 text-[10px] text-muted">
            这条链接是你以后重新登录这个账号最主要的方式——没有邮箱密码，链接丢了就找不回账号（除非你之后去&ldquo;我的账号&rdquo;页面另外设一个密码/PIN 当备用）。建议现在复制存到备忘录或密码管理器。
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
