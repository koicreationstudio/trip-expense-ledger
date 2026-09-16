'use client';

import { useState } from 'react';

export function AccountIdentityLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

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
    // fix(2026-09-17 第十九轮，独立 ui-auditor 盲测坐实——这屏"视觉冲击最大"）：
    // Artifact 的"复制链接"是 `.big-cta`，跟"创建行程"同等视觉分量的全宽黑色主按钮，
    // 长在 `.linkbox` 这个链接展示框外面（`margin-top:10px`）；之前按钮嵌在框里，
    // 用的是 `.btn-secondary`（白底细边框次要按钮），整个视觉权重从"这是本页唯一
    // 重要动作"降级成了不起眼的次要按钮。这次链接框+按钮分开、按钮改用 .big-cta。
    // 链接文字本身 `.linkbox{word-break:break-all}` 长 token 本来就会换行显示，
    // Artifact demo 里的 URL 是手动截断成"...”的假数据，不是"必须单行"的规格，
    // 这版保留换行显示（不做单行省略），只是把底色/文字色对齐 spec 的 gold-lt/gold-dk。
    <section className="flex flex-col gap-2">
      <p className="text-[10px] text-muted">
        这条链接是你重新登录这个账号唯一的方式，没有邮箱密码。换设备、清了浏览器数据时，打开这条链接就能回来。
      </p>
      <code className="break-all rounded-xl bg-gold-lt px-[9px] py-2 font-mono text-[9.5px] text-gold-dk">
        {url}
      </code>
      <button type="button" onClick={handleCopy} className="big-cta">
        {copied ? '已复制' : '复制链接'}
      </button>
    </section>
  );
}
