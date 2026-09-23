import type { Config } from 'tailwindcss';
import defaultTheme from 'tailwindcss/defaultTheme';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', ...defaultTheme.fontFamily.sans],
        // 只用在阿拉伯数字金额上（DESIGN-BRIEF.md 第三版「绝对禁止」第6条：
        // 不含中文字形的衬线体，套在中文标题上会静默回退系统衬线体，两种字体打架）。
        // 2026-09-13：字体本体从 Fraunces 换成 IBM Plex Serif，token 名和用法不变。
        serif: ['var(--font-plex-serif)', ...defaultTheme.fontFamily.serif],
        // 第五版补丁：只用在保证纯 ASCII 的场景（货币代码/双语标题英文半段），
        // 绝不碰中文（绝对禁止第14条，同 Fraunces 那条纪律）。
        mono: ['var(--font-plex-mono)', ...defaultTheme.fontFamily.mono],
      },
      colors: {
        // 第三版 DESIGN-BRIEF 全套推翻第二版的「单一强调色」纪律，直接采用
        // remy-thailand 线上页面 `:root` 里验证过的十个 hex 值，不是自己再调一遍。
        // CTA/选中态从 amber 退休，改用 ink（深藏青黑）。
        //
        // 【2026-09-23 第三十八轮：色板从候选D灰阶改回暖色系】Remy 明确表态要改回暖色
        // （见 DESIGN-BRIEF.md「第三十七轮」体检发现的矛盾——候选D灰阶跟 v5-v7 三轮
        // 反复论证过的"不能学团队工具冷灰调、这是有温度的私人记账本"直接冲突）。这次
        // 不是随手挑个暖色，是直接采用 DESIGN-BRIEF.md「色彩强度柔和化（2026-09-08）」
        // 一节里最后一次经过 WCAG 对比度实算、且被「第七版」确认继续有效的那批暖色值——
        // 那是 v3 remy-thailand 原始十色板做过一轮柔和化之后的"最终定案态"，不是 v3 最
        // 早最艳的那版。候选D引入的 accent-*/accent-circle/hero-label 这几个结构性 token
        // 保留（它们是"给 CTA/头像圈/深底文字单独开一个具名 token"这个合理的工程决定，
        // 跟灰阶还是暖色无关），只换它们指向的具体色值。下面 `positive`/`negative`（连同
        // `-dk` 变体）、`coral`、`ok`/`live`、`seafoam` 这几个候选D时期定的语义色本身
        // 就不是灰阶（是真实带色相的红/绿/蓝），不在这轮"变灰"问题范围内，原样不动。
        accent: {
          50: 'color-mix(in srgb, #23232E 6%, white)',
          100: 'color-mix(in srgb, #23232E 12%, white)',
          600: 'color-mix(in srgb, #23232E 78%, white)',
          700: '#23232E', // 跟 ink 同值，新的主 CTA / 选中态颜色（取代候选D的 Black Olive 灰）
          800: 'color-mix(in srgb, #23232E 82%, black)', // hover 按下态
        },
        ink: '#23232E', // 色彩强度柔和化（2026-09-08）定案值，比 v3 原始 #1A1A2E 饱和度低约一半，红字（该付）在此底色上对比度仍稳稳站在 3.22:1（大字号门槛之上）
        paper: '#FEFCF7',
        sand: '#EDE8DA',
        gold: '#B89E61', // 柔和化定案值，v3 原始更艳的 #C9A24B 已废弃不用
        'gold-lt': '#F0E8D6',
        'gold-dk': '#7E6630', // 三阶金色里柔和化降幅最大的一个（这是 Remy 当初反馈"标题/链接太艳"的真正成因，原始 #8B6914 饱和度比 gold 本身还高）
        // accent-circle（头像圈/图标圈）继续跟 gold 同值，只是色值本身换回暖金色，
        // token 结构和候选D落地时一致，不重新讨论要不要独立开这个 token。
        'accent-circle': '#B89E61',
        // 共用语义色板收尾落地（2026-09-11）：DESIGN-BRIEF-color-v6-preview.html 519-533行
        // 「共用语义色板速查」表定义好三轮却一直没真正接进 tailwind、代码里净额正负色
        // 一直在借用泛用 Tailwind emerald-*/red-*。这批 token 是候选 B/C/D 三个候选共用
        // 的财务语义色，不随主色调整（DESIGN-BRIEF.md 绝对禁止第12条：该收绿/该付红要
        // 保持稳定可辨识）。
        // coral 这次是更新：旧值 #E8554E 是更早候选版本的值，现在改成设计稿第525行定案
        // 的 #991B14（表单错误提示，固定色）。
        coral: '#991B14',
        // negative/positive 浅底文字色，来源设计稿第526-527行。
        negative: '#A63926',
        positive: '#3D6141',
        // negative-dk/positive-dk 是同一语义色配 Hero 深底用的浅色变体，一对一配对。
        // positive-dk 来源设计稿第528行；negative-dk 那份可视化色板表格漏列了，但文件顶部
        // :root CSS 变量区（77-80行 --a-negative-dk）有定义，跟 --a-positive-dk 是配对关系，
        // 一并补上。
        'negative-dk': '#E6B1A8',
        'positive-dk': '#B7D1A8',
        seafoam: '#2DAA85',
        'sf-lt': '#D0F0E5',
        // 【2026-09-23 第三十八轮】v3 原始暖灰值，候选D落地时把它跟 gold-dk 并成了同一个
        // 灰色号(Welded Iron #6E6E6C)——这次两者都改回各自的暖色定案值，不再共用同一色号。
        muted: '#8A7A6A',
        // 第五版补丁：状态色体系（行程/邀请/认领的进度语义），绝不跟
        // emerald(该收)/red(该付) 财务语义色混用（绝对禁止第12条）。
        // wait（待定态）复用现有 gold-dk/gold-lt，不新增 hex（色相跟
        // brand-pm 的 wait 太像，见 DESIGN-BRIEF 第五版第4条）。
        ok: '#4C7A50',
        'ok-bg': '#E3ECE0',
        live: '#3E7787',
        'live-bg': '#DFEAEC',
        // Hero 深底标签文字色：跟 sand 同色相、稀释更淡，深色 Hero 底上够亮好读
        // （原硬编码 slate-400/200 冷灰对比度不够，候选D时期取的是灰阶 sand，这次
        // 【2026-09-23 第三十八轮】换成暖色 sand #EDE8DA，结构不变）。
        'hero-label': 'color-mix(in srgb, #EDE8DA 70%, white)',
        // 2026-09-16 第十七轮补：Artifact `--cream:#F3E9D2`，"快速记账"卡里"分摊"三段式
        // 分段控件（.seg3）的轨道底色——深色卡片上垫一条暖米黄色的浅色轨道，选中项是
        // 深色实底 pill 嵌在里面，是方案里専门跟"仅我自己/平分/自定义分摊"这组配色对应
        // 的语义色，不能借用 gold-lt（那个是偏灰不是偏黄，视觉上不是同一个东西）。
        cream: '#F3E9D2',
      },
      borderRadius: {
        hero: '22px',
      },
      backgroundImage: {
        // 【2026-09-23 第三十八轮：改回暖色系】渐变主体改用「第六版（2026-09-08）」
        // 已经过 WCAG 实算验证的 ink 同色相三段式（#2A2A38→#23232E→#1B1B24，纯明度
        // 分层，不引入金色）——候选D那版把渐变主体也换成了 gold-dk(#7E6630) 起步，
        // 实算过 negative-dk(#E6B1A8) 在这个色值上对比度只有 2.93:1，没过 WCAG 大字号
        // 3:1 门槛，重蹈了候选D自己在 2026-09-12 修过的同一类"浅色文字在渐变亮段对比度
        // 不够"问题（当时是 positive-dk 在 Mountain Mist 上只有 2.12:1）。改回纯 ink
        // 色相就没有这个风险——这三个 hex 本身就是从已经验证过对比度的 ink 系衍生出来的
        // 深浅变体。右上角的光晕层（装饰性、不叠文字）换成暖金色调 rgba(184,158,97,.30)
        // （新 gold 的 RGB），呼应整体暖色调，结构（位置/大小/两层叠加顺序）不变。
        'hero-gradient':
          'radial-gradient(130px 100px at 90% 6%, rgba(184,158,97,.30), transparent 70%), linear-gradient(165deg, #2A2A38 0%, #23232E 45%, #1B1B24 100%)',
      },
      boxShadow: {
        // 外层两组阴影让卡片浮起来，inset 高光模拟顶部打光——银行卡/钱包类 UI 常见手法。
        // 【2026-09-23 第三十八轮】rgba 锚定值从候选D的 ink RGB(55,55,54) 改回暖色 ink
        // #23232E 的 RGB(35,35,46)，跟「第七版」`card` 阴影本来就用的锚定值统一。
        hero: '0 10px 24px -6px rgba(35,35,46,.35), 0 4px 10px rgba(35,35,46,.18), inset 0 1px 0 rgba(255,255,255,.08)',
        // 第七版：普通卡片的极轻两层阴影，借 team-board 的"极轻阴影"结构但色值锚定本系统的 ink，不借它的中性灰。
        card: '0 1px 2px rgba(35,35,46,.06), 0 1px 1px rgba(35,35,46,.04)',
      },
    },
  },
  plugins: [],
};

export default config;
