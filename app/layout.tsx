import type { Metadata } from 'next';
import { Inter, IBM_Plex_Serif, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

// 构建时把字体打包进产物，不在运行时连 Google 服务器——跟这个项目自己标榜的
// "数据自托管、不外流"这条调性一致，不能换成 <link> 外部 CDN 引入。
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

// 严格只用在阿拉伯数字金额上（DESIGN-BRIEF.md 第三版），不含中文字形，
// 中文标题/label 继续用 Inter，靠字号+gold-dk 文字色做个性，不换字体。
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh" className={`${inter.variable} ${plexSerif.variable} ${plexMono.variable}`}>
      <body className="min-h-screen bg-paper font-sans text-ink">
        <div className="mx-auto max-w-3xl px-4 py-8">{children}</div>
      </body>
    </html>
  );
}
