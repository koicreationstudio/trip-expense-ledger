import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

// 构建时把字体打包进产物，不在运行时连 Google 服务器——跟这个项目自己标榜的
// "数据自托管、不外流"这条调性一致，不能换成 <link> 外部 CDN 引入。
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: '消费记录 · trip-expense-ledger',
  description: '出差消费记录：记账 + 同行人代垫结清 + 汇率比对最省钱支付方式推荐',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh" className={inter.variable}>
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900">
        {/* pb-24：给右下角浮动 FAB 留出安全间距，避免遮住页面最后一块内容 */}
        <div className="mx-auto max-w-3xl px-4 pb-24 pt-8">{children}</div>
      </body>
    </html>
  );
}
