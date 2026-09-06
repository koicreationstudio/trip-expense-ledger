import type { Config } from 'tailwindcss';
import defaultTheme from 'tailwindcss/defaultTheme';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', ...defaultTheme.fontFamily.sans],
      },
      colors: {
        // 整站唯一强调色（DESIGN-BRIEF.md 定的纪律：其余全走 slate 灰阶）。
        // 具体色号（amber-700）待 Remy 确认，只要改这一处就能全站换色。
        accent: {
          50: '#fffbeb',
          100: '#fef3c7',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
        },
      },
    },
  },
  plugins: [],
};

export default config;
