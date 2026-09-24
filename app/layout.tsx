import type { Metadata, Viewport } from 'next';
import { Inter, IBM_Plex_Serif, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

// 构建时把字体打包进产物，不在运行时连 Google 服务器——跟这个项目自己标榜的
// "数据自托管、不外流"这条调性一致，不能换成 <link> 外部 CDN 引入。
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

// 严格只用在阿拉伯数字金额上（DESIGN-BRIEF.md 第三版），不含中文字形，
// 中文标题/label 继续用 Inter，靠字号+neutral-dk 文字色做个性，不换字体。
// 2026-09-13：Remy 拍板从 Fraunces 换成 IBM Plex Serif（配色对比稿定案版本），
// 只换这一个 next/font 声明 + tailwind.config.ts 的 serif token，全站 14 处
// font-serif 用法零改动地跟着换字体，维持"所有金额同一种字体"这条既有纪律。
const plexSerif = IBM_Plex_Serif({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-plex-serif',
  display: 'swap',
});

// 第五版补丁（绝对禁止第14条）：跟 Fraunces 同一条纪律——不含中文字形，
// 严格限定只用在保证纯 ASCII 的场景（货币代码/双语标题英文半段），绝不碰中文。
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: '消费记录 · trip-expense-ledger',
  description: '出差消费记录：记账 + 同行人代垫结清 + 汇率比对最省钱支付方式推荐',
};

// fix(2026-09-18，第二十五轮，Remy 要求"两个都要"——方案的紧凑字号 + 不要 iOS 自动放大跳动)：
// round22 曾经把 `.field-input`/`.field-input-dark` 真实 <input>/<textarea> 的字号硬提到
// 16px 来解除 iOS Safari"聚焦时字号<16px 就强制放大整页"这条限制，代价是牺牲了方案要的
// 10-11px 紧凑视觉。这次换一个不用改字号的路子：显式声明 `maximumScale: 1`（同时保留
// width=device-width/initialScale=1，跟 Next.js 默认值一致，不是新增限制），iOS Safari
// 收到这个 viewport 声明后，理论上不会再对小字号输入框做整页强制缩放——因为页面已经声明了
// "最大也就放大到 1 倍"，浏览器没有更大的倍数可放，聚焦缩放这个动作本身就没有意义了。
// 代价（上网查证后修正，比原先设想的要小）：iOS 10 之后，Safari **常规浏览器标签页**里已经
// 不再遵守 user-scalable/maximum-scale 对"双指缩放整页"的限制——这是苹果自己 2016 年
// WebKit 官方博客公开宣布的无障碍修正（怕网站用这个把字号锁死到用户看不清），所以 Remy
// 正常在 Safari 里打开这个网址，双指缩放不会被这条规则挡掉。真正会被挡的场景是**"添加到
// 主屏幕"后以独立 App 图标打开**（PWA standalone 模式，这个项目确实有 manifest.webmanifest）——
// 这种模式走的是系统级 WKWebView 容器，会老老实实遵守 maximum-scale=1，双指缩放在那个模式
// 下会被真的关掉。如果 Remy 是从主屏幕图标打开这个 app（不是 Safari 分享出去的书签/网址），
// 需要知情这个代价；如果她一直是从 Safari 网址/书签打开，这条代价基本不成立。
// 这个方案**没有 100% 把握在所有 iOS 版本上都解决"聚焦输入框自动放大"这个问题**——这条是
// 广泛使用的常见做法但没有官方文档保证覆盖所有 iOS 版本，如果之后实测/她自己真机上还是会跳，
// 需要回退到 round22 那套 16px 方案（两者不能同时要，16px 方案牺牲视觉紧凑度，这套方案有
// 前面说的 PWA 独立模式缩放代价，只能二选一）。
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh" className={`${inter.variable} ${plexSerif.variable} ${plexMono.variable}`}>
      <body className="min-h-screen bg-paper font-sans text-ink">
        <div className="mx-auto max-w-3xl px-4 py-8">{children}</div>
      </body>
    </html>
  );
}
