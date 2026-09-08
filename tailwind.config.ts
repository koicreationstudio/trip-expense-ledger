import type { Config } from 'tailwindcss';
import defaultTheme from 'tailwindcss/defaultTheme';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', ...defaultTheme.fontFamily.sans],
        // 只用在阿拉伯数字金额上（DESIGN-BRIEF.md 第三版「绝对禁止」第6条：
        // Fraunces 不含中文字形，套在中文标题上会静默回退系统衬线体，两种字体打架）。
        serif: ['var(--font-fraunces)', ...defaultTheme.fontFamily.serif],
      },
      colors: {
        // 第三版 DESIGN-BRIEF 全套推翻第二版的「单一强调色」纪律，直接采用
        // remy-thailand 线上页面 `:root` 里验证过的十个 hex 值，不是自己再调一遍。
        // CTA/选中态从 amber 退休，改用 ink（深藏青黑）。
        accent: {
          50: '#eceaf1',
          100: '#c9c5d6',
          600: '#2b2b45',
          700: '#1A1A2E', // ink，新的主 CTA / 选中态颜色
          800: '#121122',
        },
        ink: '#1A1A2E',
        paper: '#FEFCF7',
        sand: '#EDE8DA',
        gold: '#C9A24B',
        'gold-lt': '#F5EDD0',
        'gold-dk': '#8B6914',
        coral: '#E8554E',
        seafoam: '#2DAA85',
        'sf-lt': '#D0F0E5',
        muted: '#8A7A6A',
      },
      borderRadius: {
        hero: '22px',
      },
    },
  },
  plugins: [],
};

export default config;
