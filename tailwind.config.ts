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
        // 第五版补丁：只用在保证纯 ASCII 的场景（货币代码/双语标题英文半段），
        // 绝不碰中文（绝对禁止第14条，同 Fraunces 那条纪律）。
        mono: ['var(--font-plex-mono)', ...defaultTheme.fontFamily.mono],
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
        ink: '#23232E',
        paper: '#FEFCF7',
        sand: '#EDE8DA',
        gold: '#B89E61',
        'gold-lt': '#F0E8D6',
        'gold-dk': '#7E6630',
        coral: '#E8554E',
        seafoam: '#2DAA85',
        'sf-lt': '#D0F0E5',
        muted: '#8A7A6A',
        // 第五版补丁：状态色体系（行程/邀请/认领的进度语义），绝不跟
        // emerald(该收)/red(该付) 财务语义色混用（绝对禁止第12条）。
        // wait（待定态）复用现有 gold-dk/gold-lt，不新增 hex（色相跟
        // brand-pm 的 wait 太像，见 DESIGN-BRIEF 第五版第4条）。
        ok: '#4C7A50',
        'ok-bg': '#E3ECE0',
        live: '#3E7787',
        'live-bg': '#DFEAEC',
      },
      borderRadius: {
        hero: '22px',
      },
      backgroundImage: {
        // 第六版：Hero 卡质感重做，同一色相（H≈240°，跟 ink 一致）三段式渐变，
        // 只在明度分层，不引入新色相。跟 rounded-hero 同一套「Hero 卡专属具名 token」惯例。
        'hero-gradient': 'linear-gradient(165deg, #2A2A38 0%, #23232E 45%, #1B1B24 100%)',
      },
      boxShadow: {
        // 外层两组阴影让卡片浮起来，inset 高光模拟顶部打光——银行卡/钱包类 UI 常见手法。
        hero: '0 10px 24px -6px rgba(20,20,30,.35), 0 4px 10px rgba(20,20,30,.18), inset 0 1px 0 rgba(255,255,255,.08)',
        // 第七版：普通卡片的极轻两层阴影，借 team-board 的"极轻阴影"结构但色值锚定本系统的 ink（35,35,46），不借它的中性灰。
        card: '0 1px 2px rgba(35,35,46,.06), 0 1px 1px rgba(35,35,46,.04)',
      },
    },
  },
  plugins: [],
};

export default config;
