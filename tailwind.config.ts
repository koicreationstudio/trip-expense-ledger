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
        // 【2026-09-24 第四十轮：色板第三次反转，暖色 → 灰阶，这次是最终定案】
        // 背景：这是色板方向第三次拍板——09-16 前是暖色，09-中漂移成候选D灰阶，
        // 09-23 第三十八轮 creative-director 认定灰阶是"漂移"改回了暖色。2026-09-24
        // Remy 亲眼看了真实生产截图（暖色版"2026香港"）对比她真正在用的目标截图
        // （灰阶版"2026曼谷出差"，design-references/2026-09-24-image8）后，明确
        // 推翻第三十八轮的结论，要求改回灰阶。这不是空泛的审美反复——第三十八轮的
        // "灰阶是漂移"判断依据是文字论证（DESIGN-BRIEF 历史几节），没有拿真实截图
        // 逐值核对过；这次改动依据是对 image8 做的像素级取色（PIL 采样，见下方各
        // token 注释），不是凭印象或文字论证。
        //
        // 取色方法：对 image8（835×1659 手机截图）逐区域采样，发现采到的值跟
        // candidate D 落地时期（2026-09-11～2026-09-12，第三十八轮改回暖色之前）
        // 最后一版 tailwind.config.ts 里的定案值——独立算出的负数文字色在深卡片
        // 平坦区对比度 7.41:1、在渐变最亮点也有 3.96:1，两处都稳稳过 WCAG 大字号
        // 3:1 门槛（比第三十八轮翻车的 2.93:1 高出不少）。这不是"偷懒直接回退"，
        // 是独立验证后发现两者高度吻合——`app/apple-icon.png`（不在第三十八轮改动
        // 文件清单里，全程没被改回暖色）的实际像素也印证了这批灰阶值就是候选D时期
        // 真实上线过的颜色，不是这次重新发明的。
        //
        // 跟 candidate D 唯一的实质差异：`neutral-lt` 这次改成字面值 `#EDECE9`，不再用
        // `color-mix(in srgb, #A4A3A0 30%, white)` 算出来的 `#E4E3E2`——候选D时期
        // tailwind.config.ts 用公式算、但 `reference/artifact-v10-source.html`
        // 的 `:root` 一直是字面 `#EDECE9`，两个文件本来就不一致；这次拿 image8 里
        // 顶部导航 tab 轨道底色实测像素采样出来的是 `#EDECE9`，公式算出来的
        // `#E4E3E2` 偏暗了一档跟实际不符，索性两个文件都统一成验证过的字面值。
        //
        // accent-*/accent-circle/hero-label 这几个结构性 token 保留（"给 CTA/
        // 头像圈/深底文字单独开一个具名 token"这个工程决定，跟灰阶还是暖色无关），
        // 只换它们指向的具体色值。下面 `positive`/`negative`（连同 `-dk` 变体）、
        // `coral`、`ok`/`live`、`seafoam` 这几个财务/状态语义色，从第一次候选D
        // 落地到这次三轮反转全程没变过（历次 diff 核对过，逐值一致）——这几个色
        // 从来不是"暖色 vs 灰阶"这个问题的一部分，不在这轮改动范围内，原样不动。
        //
        // 【2026-09-24 第四十一轮：token 改名，`gold`/`gold-lt`/`gold-dk` →
        // `neutral`/`neutral-lt`/`neutral-dk`】第四十轮把颜色从暖色改回灰阶后，
        // 命名一直没跟着改，`gold` 这个名字实际指向的是灰色（不是金色），容易让人
        // 看代码时误判颜色。这轮只改名字，hex 值完全没动。`sand`（#DBDAD6）这个
        // 名字虽然现在饱和度也很低、肉眼接近灰色，但「沙」本身可以合理形容浅灰调，
        // 不像「金」那样特指鲜明的暖色调，属于没那么明确的边界情况，这轮没有一并
        // 改名，留给 Remy 看了如果觉得也该改再说。
        accent: {
          50: '#f2f2f2',
          100: '#e0e0e0',
          600: '#595959',
          700: '#373736', // Black Olive，跟 ink 同值，主 CTA / 选中态颜色
          800: 'color-mix(in srgb, #373736 82%, black)', // hover 按下态，同时是 Hero 渐变最深端
        },
        ink: '#373736', // 像素采样自 image8"行程主页"选中胶囊 + "快速记账"卡片实底：RGB(55,55,54)
        paper: '#F7F7F6', // 像素采样自 image8 整页背景（众数采样，最大占比色）：RGB(247,247,246)
        sand: '#DBDAD6', // 像素采样自 image8 浅色容器边框：RGB(219,218,215)，跟候选D定案值 #DBDAD6 几乎完全吻合
        neutral: '#A4A3A0',
        // 字面值改用实测像素 #EDECE9（原公式 color-mix(#A4A3A0 30%, white) 算出
        // #E4E3E2，偏暗一档，image8 里顶部导航 tab 轨道底色实测是 #EDECE9，改用
        // 验证过的字面值，参见上方色板总注释）。
        'neutral-lt': '#EDECE9',
        'neutral-dk': '#6E6E6C', // 跟 muted 共用同一色号(Welded Iron)，候选D设计如此，非失误
        // accent-circle（头像圈/图标圈）跟 neutral 同值。
        'accent-circle': '#A4A3A0',
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
        muted: '#6E6E6C', // 跟 neutral-dk 共用同一色号(Welded Iron)，候选D设计如此，非失误
        // 第五版补丁：状态色体系（行程/邀请/认领的进度语义），绝不跟
        // emerald(该收)/red(该付) 财务语义色混用（绝对禁止第12条）。
        // wait（待定态）复用现有 neutral-dk/neutral-lt，不新增 hex（色相跟
        // brand-pm 的 wait 太像，见 DESIGN-BRIEF 第五版第4条）。
        ok: '#4C7A50',
        'ok-bg': '#E3ECE0',
        live: '#3E7787',
        'live-bg': '#DFEAEC',
        // Hero 深底标签文字色：跟 sand 同色相、稀释更淡，深色 Hero 底上够亮好读
        // （原硬编码 slate-400/200 冷灰对比度不够）。像素采样自 image8 深卡片上
        // "该付出·5笔消费"这类说明文字：RGB(230,229,227)，跟这条公式算出来的
        // color-mix(#DBDAD6 70%, white)≈(230,229,226) 几乎完全吻合，公式不用改。
        'hero-label': 'color-mix(in srgb, #DBDAD6 70%, white)',
        // 2026-09-16 第十七轮补：Artifact `--cream:#F3E9D2`，"快速记账"卡里"分摊"三段式
        // 分段控件（.seg3）的轨道底色——深色卡片上垫一条暖米黄色的浅色轨道，选中项是
        // 深色实底 pill 嵌在里面，是方案里専门跟"仅我自己/平分/自定义分摊"这组配色对应
        // 的语义色，不能借用 neutral-lt（那个是偏灰不是偏黄，视觉上不是同一个东西）。
        cream: '#F3E9D2',
      },
      borderRadius: {
        hero: '22px',
      },
      backgroundImage: {
        // 【2026-09-24 第四十轮：改回灰阶】渐变三段式 #6E6E6C→color-mix(ink 82%
        // black)→同值收平——这是候选D 2026-09-12 那次"净额协调度走查"修过对比度问题
        // 之后的最终版（原始候选D第一版渐变起点是更亮的 Mountain Mist #A4A3A0，导致
        // positive-dk 浅绿字在渐变亮段对比度只有 2.12:1，那次已经改成从 Welded Iron
        // 起步、早早进暗段），像素采样 image8 深卡片渐变区从顶部到底部逐行核对过，
        // 平坦区落在 RGB(44,44,43)，跟这条 color-mix 公式算出来的 (45,45,44) 只差
        // 1 个单位（四舍五入误差，不是设计差异）。右上角光晕层保留候选D原值
        // rgba(219,218,214,.30)（sand 的 RGB），结构（位置/大小/两层叠加顺序）不变。
        'hero-gradient':
          'radial-gradient(130px 100px at 90% 6%, rgba(219,218,214,.30), transparent 70%), linear-gradient(165deg, #6E6E6C 0%, color-mix(in srgb, #373736 82%, black) 30%, color-mix(in srgb, #373736 82%, black) 100%)',
      },
      boxShadow: {
        // 外层两组阴影让卡片浮起来，inset 高光模拟顶部打光——银行卡/钱包类 UI 常见手法。
        // 【2026-09-24 第四十轮】rgba 锚定值改回灰阶 ink #373736 的 RGB(55,55,54)。
        hero: '0 10px 24px -6px rgba(55,55,54,.35), 0 4px 10px rgba(55,55,54,.18), inset 0 1px 0 rgba(255,255,255,.08)',
        // 第七版：普通卡片的极轻两层阴影，借 team-board 的"极轻阴影"结构但色值锚定本系统的 ink，不借它的中性灰。
        card: '0 1px 2px rgba(55,55,54,.06), 0 1px 1px rgba(55,55,54,.04)',
      },
    },
  },
  plugins: [],
};

export default config;
