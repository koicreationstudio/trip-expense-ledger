'use client';

import { useState } from 'react';

export function AccountIdentityLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  // fix(2026-09-17 第二十一轮，功能性QA发现)：剪贴板权限拿不到时之前是完全静默——
  // 按钮点了文字不变、也没有任何提示，用户没法判断"是复制成功了还是点击没反应"。
  // 链接本来就显示在页面上（下面的 <code>），加一句失败提示，不是要新做什么复制
  // 兜底逻辑，只是把"失败"这个已有分支也变得看得见，跟"成功"分支（copied状态）
  // 对称。
  const [copyFailed, setCopyFailed] = useState(false);

  // fix(2026-09-24 第五十八轮，Remy 截图反馈)：完整身份链接原本直接摊开显示，
  // 谁截个图都会把这条能免密登录她账号的链接带出去。这轮改成默认收起、点开
  // 才展开——折叠态的"点开才展开"视觉规格照搬 invites-manager.tsx 里"直接添加
  // 参与者"那个已经在用的 tap-link 文字链接模式（这个项目里唯一已有的同类
  // 折叠交互先例，DESIGN-BRIEF.md 没单独定过这页的规格，不新造样式）。
  // PIN 找回（SetPinForm）现在是本页主要找回方式，身份链接降级成备用说明。
  const [expanded, setExpanded] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
    }
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="tap-link self-start text-left text-[10.5px] text-muted underline underline-offset-2"
      >
        备用：身份链接 ▸
      </button>
    );
  }

  return (
    // fix(2026-09-17 第十九轮，独立 ui-auditor 盲测坐实——这屏"视觉冲击最大"）：
    // Artifact 的"复制链接"是 `.big-cta`，跟"创建行程"同等视觉分量的全宽黑色主按钮，
    // 长在 `.linkbox` 这个链接展示框外面（`margin-top:10px`）；之前按钮嵌在框里，
    // 用的是 `.btn-secondary`（白底细边框次要按钮），整个视觉权重从"这是本页唯一
    // 重要动作"降级成了不起眼的次要按钮。这次链接框+按钮分开、按钮改用 .big-cta。
    // 链接文字本身 `.linkbox{word-break:break-all}` 长 token 本来就会换行显示，
    // Artifact demo 里的 URL 是手动截断成"...”的假数据，不是"必须单行"的规格，
    // 这版保留换行显示（不做单行省略），只是把底色/文字色对齐 spec 的 neutral-lt/neutral-dk。
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setExpanded(false)}
        className="tap-link self-start text-left text-[10.5px] text-muted underline underline-offset-2"
      >
        备用：身份链接 ▾
      </button>
      <p className="text-[10px] text-muted">
        没有邮箱密码，这条链接是找回账号的备用方式——上面已经设了密码/PIN 就优先用 PIN 找回（新建行程页面也有
        “我设过密码/PIN，直接找回”的入口）。换设备、清了浏览器数据又没设 PIN 时，靠这条链接也能回来，注意别把它截图分享出去。
      </p>
      <code className="break-all rounded-xl bg-neutral-lt px-[9px] py-2 font-mono text-[9.5px] text-neutral-dk">
        {url}
      </code>
      <button type="button" onClick={handleCopy} className="big-cta">
        {copied ? '已复制' : '复制链接'}
      </button>
      {copyFailed && (
        <p className="text-[10px] text-coral">复制失败（浏览器不给剪贴板权限），可以手动选取上面的链接文字复制。</p>
      )}
    </section>
  );
}
