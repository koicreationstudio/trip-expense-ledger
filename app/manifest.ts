import type { MetadataRoute } from 'next';

// 这份 manifest 只是给"加到主屏幕"用一个像样的图标 + 名字，不代表这个 app 是完整 PWA
// ——目前没有 service worker，没做离线支持，纯粹是网页。display: 'standalone' 只影响
// 从主屏幕图标打开时的窗口外观（隐藏浏览器地址栏），跟离线能力无关。
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '消费记录 · trip-expense-ledger',
    short_name: '消费记录',
    description: '出差消费记录：记账 + 同行人代垫结清 + 汇率比对最省钱支付方式推荐',
    start_url: '/',
    display: 'standalone',
    background_color: '#FEFCF7',
    theme_color: '#23232E',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
