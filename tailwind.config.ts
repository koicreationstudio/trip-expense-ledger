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
        // 候选D「渐变灰阶」落地（2026-09-11）：5 阶无彩色灰阶(Bleached Silk/First Star/
        // Mountain Mist/Welded Iron/Black Olive)，取值来源 DESIGN-BRIEF-color-v6-preview.html
        // .variant-grayscale .app-screen 区块 + DESIGN-BRIEF-color-directions.md 第六提案候选D表格。
        // ink 跟 accent-700 这次是同一个值(#373736)，是候选D「标题/Hero/CTA/选中态统一用同一级
        // 最深灰」的设计意图，不是失误。accent-600/100/50 是 0 处引用的预留色阶，按 ink 新值
        // 提亮到约 L35%/L88%/L95% 估算(纯中性灰，不抠小数点)。
        accent: {
          50: '#f2f2f2',
          100: '#e0e0e0',
          600: '#595959',
          700: '#373736', // Black Olive，候选D的 ink，同时也是新的主 CTA / 选中态颜色
          800: 'color-mix(in srgb, #373736 82%, black)', // hover 按下态，同时也是 Hero 渐变最深端
        },
        ink: '#373736',
        paper: '#F7F7F6',
        sand: '#DBDAD6',
        gold: '#A4A3A0',
        'gold-lt': 'color-mix(in srgb, #A4A3A0 30%, white)',
        'gold-dk': '#6E6E6C', // 跟 muted 共用同一色号(Welded Iron)，候选D设计如此，非失误
        // 候选D落地补丁(2026-09-11 第二轮)：头像圈/图标圈/未选中分段按钮在候选D设计里
        // 本来是独立的 accent-circle 角色(Mountain Mist)，首轮落地图省事分别借用了 sand(头像圈)
        // /gold-lt(图标圈)，Remy 拍板改回方案②，新开这个独立 token，真实颜色不变(凑巧
        // 跟 gold 同值)，但语义上跟 sand/gold-lt 解耦，以后要单独调头像圈/图标圈颜色不会
        // 牵动 sand/gold-lt 的其它引用处。分段按钮这次代码库里还没实体组件，先不接。
        'accent-circle': '#A4A3A0',
        coral: '#E8554E',
        seafoam: '#2DAA85',
        'sf-lt': '#D0F0E5',
        muted: '#6E6E6C',
        // 第五版补丁：状态色体系（行程/邀请/认领的进度语义），绝不跟
        // emerald(该收)/red(该付) 财务语义色混用（绝对禁止第12条）。
        // wait（待定态）复用现有 gold-dk/gold-lt，不新增 hex（色相跟
        // brand-pm 的 wait 太像，见 DESIGN-BRIEF 第五版第4条）。
        ok: '#4C7A50',
        'ok-bg': '#E3ECE0',
        live: '#3E7787',
        'live-bg': '#DFEAEC',
        // 候选D落地补丁：Hero 深底标签文字色，取值来源 DESIGN-BRIEF-color-v6-preview.html
        // 209-265行候选D区块 + DESIGN-BRIEF-color-directions.md 第六提案候选D表格，
        // First Star 稀释更淡，深灰 Hero 底上够亮好读（原硬编码 slate-400/200 冷灰对比度不够）。
        'hero-label': 'color-mix(in srgb, #DBDAD6 70%, white)',
      },
      borderRadius: {
        hero: '22px',
      },
      backgroundImage: {
        // 候选D落地：Hero 渐变改灰阶三段式(Mountain Mist → Welded Iron → Black Olive 82%压暗)，
        // 取值来源 v6-preview.html .variant-grayscale .hero 区块。
        'hero-gradient': 'linear-gradient(165deg, #A4A3A0 0%, #6E6E6C 55%, color-mix(in srgb, #373736 82%, black) 100%)',
      },
      boxShadow: {
        // 外层两组阴影让卡片浮起来，inset 高光模拟顶部打光——银行卡/钱包类 UI 常见手法。
        // 候选D落地：rgba 锚定值从旧 ink (35,35,46) 换成新 ink #373736 的 RGB (55,55,54)。
        hero: '0 10px 24px -6px rgba(55,55,54,.35), 0 4px 10px rgba(55,55,54,.18), inset 0 1px 0 rgba(255,255,255,.08)',
        // 第七版：普通卡片的极轻两层阴影，借 team-board 的"极轻阴影"结构但色值锚定本系统的 ink，不借它的中性灰。
        card: '0 1px 2px rgba(55,55,54,.06), 0 1px 1px rgba(55,55,54,.04)',
      },
    },
  },
  plugins: [],
};

export default config;
