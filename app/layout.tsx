import type { Metadata } from 'next';
import { Inter, Fraunces } from 'next/font/google';
import './globals.css';

// 构建时把字体打包进产物，不在运行时连 Google 服务器——跟这个项目自己标榜的
// "数据自托管、不外流"这条调性一致，不能换成 <link> 外部 CDN 引入。
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

// Fraunces 严格只用在阿拉伯数字金额上（DESIGN-BRIEF.md 第三版），不含中文字形，
// 中文标题/label 继续用 Inter，靠字号+gold-dk 文字色做个性，不换字体。
const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-fraunces',
  display: 'swap',
});

export const metadata: Metadata = {
  title: '消费记录 · trip-expense-ledger',
  description: '出差消费记录：记账 + 同行人代垫结清 + 汇率比对最省钱支付方式推荐',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh" className={`${inter.variable} ${fraunces.variable}`}>
      <body className="min-h-screen bg-paper font-sans text-slate-900">
        <div className="mx-auto max-w-3xl px-4 py-8">{children}</div>
      </body>
    </html>
  );
}
