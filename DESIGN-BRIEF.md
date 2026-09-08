# trip-expense-ledger 设计简报（第三版 + 第四版尺寸密度补丁）

> 第二版做的是"信息架构大改"（余额优先、参与者列表升级成净欠款清单、活动流去掉私有过滤），这部分已经落地（commit 1488fb4）且这次不重做。
>
> 这一版要修的是第二版留下的一个明确误判。第二版参照 remy-thailand 时写道："trip-expense-ledger 是'把钱算准'的记账工具，照搬会显得在山寨"，据此决定不学它的暖色系配色和衬线展示字体，延续第一版"单一强调色、线条图标、不用 emoji"的纪律。
>
> Remy 原话："界面设计我觉得太单调了，这个 ui director 和 creative director 没有过一下吗？我要像 remy-thailand.pages.dev 这样可以实时看到汇率对比……你再仔细琢磨琢磨。"
>
> 这一版明确纠正上面那条判断，理由见下面 Step 0。这次不是"选一个手法学一学"，是把 remy-thailand 验证过的整套视觉系统（配色变量、字体、圆角尺度、图标语言）当直接依据——不是凭截图肉眼猜的，是直接 `curl` 了它线上页面的真实 CSS 拿到的。

> **2026-09-08 第四版补丁说明（只改尺寸密度，别的都不动）**：第三版把"视觉单调"改丰富了，但落地实测后 Remy 反馈"全部东西都很大很占位子"，点名净额卡片那个巨大的 Fraunces 数字"太夸张"。根因写在 `user_compact_ui_preference.md`（Remy 的紧凑基准，2026-09-08 补记了这次复发）：这条记忆 65 天前就写好了、也点名"任何新 UI 都按这个来"，但第三版出简报时没查这条记忆，自己定了一套偏移动端营销页的字号/留白规格。这次补丁**只管字号、padding、留白、触控热区这四个尺寸维度往紧凑基准靠拢**，色板/字体家族/圆角/emoji 这些第三版定的表现力维度**原样不动**——Remy 反馈的是"占位子"不是"太丰富"，紧凑跟有个性不冲突，别借这次补丁把第三版的判断也一起推翻了。具体改动见下面新增的「第四版补丁 — 尺寸密度收紧」整节。

## Step 0：这次是什么性质的改动

这次不是再做一轮信息架构，第二版定的 4 段式页面结构（余额 Hero 卡 → 参与者净欠款清单 → 全行程活动流 → 浮动 FAB）完全保留。这次是两件事一起做：①纠正第二版对"视觉丰富度"的误判，重新定调色板/字体/圆角/图标 ②给这轮新确认的功能范围（钱包、换汇记录、比价卡片视觉升级）出具体视觉方案。

**纠偏的论证**（不是"要丰富一点"这种空喊，是拿 remy-thailand 的真实实现反驳第二版自己的逻辑）：

第二版的判断建立在一个没有证据支撑的假设上——"记账工具"和"视觉丰富"是对立的，克制才显得专业。但 remy-thailand 本身也是一个"把钱算准"的工具：算实时汇率、比较四个换汇渠道谁更划算、追踪多个钱包的真实余额，跟 trip-expense-ledger 做的是同一类事情。它的视觉一点都不克制：

- 标题用 Fraunces 衬线斜体 + 金色渐变字（"Travel *Expenses*"），跟其余 Geist 无衬线正文形成强烈反差，不是一种字体贯穿到底
- 全站图标零例外全是 emoji，连关闭按钮（✕）和新增按钮（＋）都是文字符号，不是 SVG 图标库
- 页面背景是暖米白 `#FEFCF7`，不是冷白或纯白
- 换汇渠道比价卡片纵向堆叠，最优的一张用薄荷绿实底 + 白字徽章高亮，不是均质灰阶排列
- 深色 Hero 卡片配超大数字，明暗和尺寸反差很大

这套东西没有让 remy-thailand 显得"不专业"或"不精确"——它照样把汇率算到小数点后三位、把手续费拆解到每个渠道。这说明"精确"和"视觉丰富"从来不是互斥的两端，克制是第二版自己加的一层没有证据的预设，这次撤销。

**给谁看这条也要一并订正**：CLAUDE.md 2026-09-07 已更新，trip-expense-ledger 现在是 Remy 自己每天在用的私有部署，不是要给陌生客户第一眼留下"专业软件"印象的展示页；同时它还是公开 GitHub 仓库给其他开发者看。第二版把"公开"和"必须克制"绑在一起，但 remy-thailand 同样是任何人都能打开的公开部署，视觉个性跟"是否公开"没有必然因果关系。这次的态度是：专业度靠代码质量和权限边界的硬规矩体现（CLAUDE.md 里那些测试覆盖率/越权 404 的要求一个字不动），不用靠"看起来朴素"去证明。

**这次新增的功能范围**（已跟 Remy 确认数据模型，这份简报只出视觉方向，不碰数据模型本身）：
- 钱包：每个参与者在每趟行程下自由建/命名多个钱包，各自绑定一个币种、有当前余额，**私有**（只有自己看得到自己的钱包）
- 换汇记录：一笔记录 = 某个钱包（或无来源纯充值）→ 某个钱包，两个金额换算出隐含汇率，带日期备注，保存后自动更新两个钱包余额
- 记消费时如果支付方式绑定了钱包且币种一致，自动扣减该钱包余额
- 比价功能（差异化卖点）视觉权重要大幅提升，向 remy-thailand 那种"多渠道纵向堆叠 + 最优高亮徽章"靠拢

证据留档：8 张 remy-thailand 实机截图在 `/private/tmp/claude-501/-Users-linotan-Desktop-Claude/dce901fe-9f8f-44ac-b172-f8c6cafdcc35/scratchpad/remy-thailand-research/`（首页/钱包卡片/换汇弹窗/换汇弹窗选中态/记账表单/设置页/设余额页），CSS 变量和字体引入直接从线上页面源码里取的，不是估的。

## 定位

**一句话**：打开它应该感觉像 remy-thailand 那样"我自己在用的、看着就顺眼的记账小本子"，同时依然一眼看到该收该付多少钱——不是企业财务后台，也不是营销落地页。

**调性关键词**（5 个，替换第二版里"克制精确/单一强调色/工具感"这部分，其余延续）：
1. **余额优先**（延续，未推翻）——欠了多少该收多少一眼看到
2. **谁欠谁清楚可见**（延续，未推翻）——参与者是一份账目关系清单
3. **视觉丰富但语义分明**（新，推翻"克制"）——颜色/字体反差本身承担"这是钱/这是提示/这是赢家"的分类功能，不是纯装饰堆砌
4. **手机优先单手操作**（延续）
5. **有温度的私人记账本，不是企业仪表盘**（新，正式推翻"工具感而非消费品感"）

## 参照

### remy-thailand.pages.dev——这次的核心参照，整套视觉系统平移，不是挑几个手法

**验证方式**：`curl` 抓了线上页面源码，直接读 `:root` 里定义的 CSS 变量和 `<link>` 引入的 Google Fonts，不是凭截图肉眼猜配色。

**字体**（`<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..600&family=Geist:wght@300;400;500;600...">`）：
- 大数字和标题用 `font-family:'Fraunces',serif`（可变字重 300-700，含斜体 300-600，带 optical size 轴）
- 正文用 `font-family:'Geist', -apple-system, system-ui, sans-serif`

**色板**（源码里 `:root` 的原始变量，十个值）：
```
--ink:     #1A1A2E   近黑藏青，深色反转卡/主按钮/选中态
--paper:   #FEFCF7   暖米白，页面背景
--sand:    #EDE8DA   暖米灰，卡片边框/分隔线
--gold:    #C9A24B   哑金，装饰性强调色（标题斜体字/次要链接文字）
--gold-lt: #F5EDD0   浅金，图标底色/info 徽章底
--gold-dk: #8B6914   深金，info 徽章文字/次要链接文字色
--coral:   #E8554E   珊瑚红，警示色
--seafoam: #2DAA85   薄荷绿，"最优/成功"语义色
--sf-lt:   #D0F0E5   浅薄荷绿，"最优"卡片高亮底
--muted:   #8A7A6A   暖灰，次要/说明文字
```

**圆角尺度**：pill 999px（chip/badge/按钮/FAB）、标准卡片 14px（钱包卡/交易行/汇率卡通用同一档）、Hero 大卡 22px、Modal 顶部 28px、输入框 12px。

**图标语言**：全站零图标库，连关闭（✕）和新增（＋）按钮都是 Unicode 文字符号，不是 SVG icon。钱包类型、支付渠道、分类、设置行全部是 literal emoji。

**微动效**：`:active { transform: scale(.96) }` 点击回弹反馈，Modal `slideUp` 0.26s 滑入，**没有任何 hover 态**（remy-thailand 本身是纯移动端产品）。这条本来就跟第一版"禁浮夸 hover"的纪律不冲突——`:active` 是触屏点击反馈，`:hover` 是桌面鼠标停留，两回事。

### Splitwise——第二版定的信息架构层参照，这次不变

"总额先出现，按人拆解的清单紧跟其后"+ 结算清单用"头像 + 箭头 + 头像"表示流向，这两条第二版已经落地，这次不重新论证。

## 绝对禁止

分两块：第一版/第二版定的、这次依然有效的纪律；这轮"视觉丰富化"这个新方向本身容易翻车的地方。

### 延续有效
1. **蓝紫渐变背景**——不管视觉多丰富，这个不是丰富，是没挑过配色的默认脸。
2. **Tailwind 默认蓝 `bg-blue-600`**——理财类产品扎堆"安全蓝"最没记忆点，这条判断跟色板丰不丰富无关，继续禁。
3. **给按钮加"只有 hover 才触发"的动效**——remy-thailand 的 `:active { scale(.96) }` 是触屏点击反馈，不是这条禁的东西；触屏本来没有 hover，这条不变。
4. **拿"视觉更丰富"当理由放松权限边界/测试覆盖率**——CLAUDE.md 里"任何查询消费明细必须硬编码过滤条件""结算接口禁止对象展开"这些硬规矩，这次纠偏只管视觉，不碰这些。

### 这轮新增（丰富化本身容易翻车的具体反例）
5. **全站到处都用 Fraunces**——反例：把表单 label、正文说明、按钮文字也换成衬线体。为什么不行：serif 的识别力来自"跟周围 sans-serif 正文形成反差"，remy-thailand 只把它用在大数字和标题上，其余全是 Geist；满屏都是 serif，反差消失，等于白引入这个字体，退回"字体没认真挑过"的状态，只是换了个更花哨的默认脸。
6. **给中文标题/文字套用 Fraunces 斜体效果**——反例：把 `trip.name`（中文行程名，比如"曼谷出差"）也套上 `font-serif italic`。为什么不行：Fraunces 是纯拉丁衬线字体，不含中文字形，中文字符会静默回退到系统默认衬线体（通常是宋体一类），起不到 remy-thailand 那种斜体金色的效果，反而让页面里两种字体打架。remy-thailand 能这么用是因为它标题是纯英文品牌词"Travel Expenses"，这个前提在 trip-expense-ledger 不成立——这里所有真实内容（行程名/钱包名/分类/备注）都是中文。**Fraunces 这次严格限定只用在阿拉伯数字金额上**，标题文字的个性靠字号 + `gold` 文字色去做，不换字体。
7. **同一行堆超过一个 emoji**——反例：remy-thailand 自己 Hero 卡片那行"我承担·THB 等值 不含✈️🏨💎"其实挤了三个 emoji，这是它自己的一个小瑕疵，不必照抄这个密度。trip-expense-ledger 每处最多配一个 emoji 锚定一个内容类型（一个钱包一个图标，一个换汇记录一个方向图标），别在同一行文字里插好几个。
8. **引入 `gold`/`coral`/`seafoam` 后乱用语义**——反例：随手拿 `coral` 标一个跟"警示"无关的区块，或者拿 `seafoam` 标一个跟"省钱推荐"无关的东西。为什么不行：颜色变多之后每种颜色必须绑定固定语义，乱用会让"多色"从"信息更清楚"变成"花但看不懂"——下面"视觉决定"已经把每个颜色的语义钉死，新增用法前先对照这张表，不能自己现造。
9. **圆角只改了卡片，输入框/按钮还留旧值**——反例：钱包卡片用了 `rounded-xl`，旁边的表单输入框还是原来的 `rounded-md`。这次是整套圆角尺度一起换，不是挑几个组件单独放大。
10. **照搬 remy-thailand"钱包数量固定不可扩展"这个前提**——remy-thailand 写死 7 个钱包、横向滚动展示，没有新建入口，因为它是单人固定场景。trip-expense-ledger 的钱包是每个人自由建、随时新增的，如果照抄它"没有 + 新建钱包按钮"这个具体实现细节，会让这轮新加的核心功能没法自助使用。参照它的卡片视觉，不代表参照它"数量固定"这个前提。

**第四版补丁新增的一条**（尺寸密度这个方向本身容易翻车的地方，见下面整节）：

11. **把"视觉丰富"跟"字号大/留白多"当成同一件事**——反例：第三版把净额卡片数字堆到 `text-5xl sm:text-6xl`（48-60px），理由写的是"跟 remy-thailand 深色 Hero 卡片配超大数字，明暗和尺寸反差很大"保持一致。为什么不行：remy-thailand 的"反差大"来自深色底配金色/白色文字的**明暗**反差和字体的**衬线/无衬线**反差，不等于它的数字本身有多大——而且 Remy 的紧凑基准（`user_compact_ui_preference.md`）在这次改版 65 天前就已经写死了具体数值（卡片标题 12.5px、副信息 10px、FAB 44×44px 等），这条基准没有例外条款允许"因为这次视觉更丰富所以字号可以放大"。视觉丰富度是配色/字体反差/图标语言这三件事，尺寸密度是另一件独立的事，两者要同时满足，不能拿一个当理由牺牲另一个。

## 视觉决定

### 色板

直接采用上面参照里验证过的十个 hex 值，不用自己再调一遍。具体分工：

- **`ink #1A1A2E`——新的主 CTA / 选中态颜色，取代原来的 `accent-700(#B45309)`**。这是这次最大的一处结构性变化。`tailwind.config.ts` 里现在的 `accent` token（`extend.colors.accent`）本来就留了注释"具体色号待 Remy 确认，只要改这一处就能全站换色"——这次就是改这一处，把 CTA 从暖橙色改成深藏青黑。理由：remy-thailand 的 `.btn-primary`/`.chip-on`/`.wpick-btn.selected`/`.fab` 全部是 `ink` 做底色，`gold` 在它的系统里从来不是按钮色，只是装饰性强调色（标题斜体字、次要提示文字）。继续用 amber-700 当 CTA，会跟新引入的 gold 系颜色撞成两套"看起来都差不多的金黄色"，反而更乱，不如直接退休 `accent` 这个 token。
- **`gold #C9A24B` / `gold-lt #F5EDD0`（浅底） / `gold-dk #8B6914`（深字）**——装饰性强调色，只用在：行程标题里的强调文字色、次要辅助链接（比如"刷新汇率"这类非主操作的文字按钮）、info 类小徽章底色。**不用于任何"点这里"的主操作**。
- **`sand #EDE8DA`**——取代原来卡片边框/分隔线的 `slate-200`/`slate-300`。这一处替换是"暖感"最大的来源，冷灰边框换成暖米色，比换字体换图标加起来的效果都直接。
- **`paper #FEFCF7`**——取代 `app/globals.css` 里 `body { background-color: #f8fafc }` 这行冷白背景。
- **`coral #E8554E`**——警示/危险语义色（未来如果有删除/危险操作用这个，不用纯 `red-600`——`red-600` 已经是"该付款"的财务语义，别混用）。
- **`seafoam #2DAA85` / `sf-lt #D0F0E5`——专门给"比价最划算"这个语义用，跟"该收"用的 `emerald-600` 分开**。理由：这是两件不同的事，一个是"我跟同行人之间欠多少钱"，一个是"这笔消费选哪个支付方式更省"。共用 emerald 会让用户扫视页面时把两种不同性质的绿色高亮混成一回事，拆成两个颜色反而更清楚，不是画蛇添足。
- **保留不变：`emerald-600` = 该收/正净额，`red-600` = 该付/负净额**——第一版就定了，这次没理由动，财务语义色是最不该乱换的地方。

### 字体

新增 **Fraunces**（`next/font/google`，`weight: ['300','400','500','600','700']`，`style: ['normal','italic']`，可变字重轴，跟 remy-thailand 引入的一致），**严格限定只用在阿拉伯数字金额上**：Hero 净额大数字、钱包卡余额、换汇表单金额输入框、比价卡片金额、换汇记录金额、结算页净值和转账金额。原因见"绝对禁止"第 6 条——中文字符不能套这个字体。

行程标题（`trip.name`）**不换字体**，继续 Inter，但可以放大字号 + 用 `gold-dk` 文字色做强调，靠颜色和字号制造个性，不靠换字体制造个性。**（第四版补丁：这里的"放大字号"这句话已经被下面「尺寸密度收紧」推翻——行程标题这次是缩小,不是放大,靠 `gold-dk` 文字色继续做强调,字号这条依据作废。）**

Inter 继续管全部正文/label/按钮文字，**不换成 remy-thailand 用的 Geist**——两者气质接近，Inter 是第一版已经工程落地的选择（`next/font/google` + `--font-inter` CSS 变量 + tailwind `fontFamily.sans` 映射），没理由为了"更像"重新接一个字体文件，这次精力该花在"哪里用 Fraunces"这个更影响观感的决定上。

### 圆角

整体从第二版"小圆角 `rounded-md`(6px) 为主"改成 remy-thailand 的量级：
- 标准卡片（钱包卡/活动流卡/换汇记录卡/参与者列表容器）：`rounded-xl`(12px)
- "本页最重要信息"的卡片（Hero 净额卡、比价最优高亮卡）：`rounded-[22px]`——直接用 remy-thailand summary-card 验证过的精确值，不用 tailwind 默认档位凑近似
- 输入框：`rounded-xl`(12px，第二版是 `rounded-md` 6px，这次放大)
- 按钮/徽章/chip/FAB：统一 `rounded-full`

这是彻底推翻第二版"小圆角=精确"的判断。这次的默认逻辑是：友好度用圆角给，精确度用数字排版（`tabular-nums` + 财务语义色）给，两者不冲突，不用靠直角撑"专业感"。**圆角数值这次不动，第四版补丁只改字号/padding/gap/触控热区,不动这套圆角尺度。**

### 间距密度

延续第二版"单列信息流，不做多列表格"，这条没错，不用推翻。

**⚠️ 以下这句是第三版原文，已被第四版补丁推翻，只留作记录不再执行**：~~卡片内边距在"本页最重要信息"的区块（Hero 卡/钱包卡余额/比价最优高亮卡）从 `p-3`(12px) 放宽到 `p-4`~`p-5`(16-20px)，跟 remy-thailand summary-card 的 `padding:20px` 量级一致；普通列表行（参与者/活动流/换汇记录）维持 `p-3` 不用跟着放大，这次只是把新组件也接上同一套标准。~~ 这套"往 remy-thailand 的 20px 靠"的判断没有对照 Remy 自己的紧凑基准，实测证明放宽过头了。**新的 padding/gap 具体数值见下面「第四版补丁 — 尺寸密度收紧」整节，那节是当前唯一权威版本。**

### 图标

**这次起默认用 emoji，不再往项目里新增 lucide-react 图标用途。**

判断依据：remy-thailand 连关闭按钮（✕）和新增按钮（＋）都是文字符号不是 SVG 图标，全站零图标库，这恰恰是它"看起来像个人在用的小工具而不是企业 SaaS"的观感来源之一——Remy 指名要的就是这种质感。公开开源项目 emoji 渲染在不同系统略有差异，这个风险是真实存在的，但产品调性判断这次优先于这个次要风险。

已经接入项目的两处 lucide（`record-expense-fab.tsx` 的 `Plus`、`expense-form.tsx` 比价徽章的 `Check`）不用为了"统一成 emoji"回头返工，留着不影响观感也没额外维护成本；但这轮新增的场景（钱包类型图标、换汇方向图标、支付方式选择器图标）一律用 emoji，不再扩编 lucide 这条线。**图标用什么这条第四版不动，第四版只管这些图标容器的物理尺寸（比如 emoji 圆形底、编辑/删除按钮的点击热区），具体数值见下面新增整节。**

## 第四版补丁 — 尺寸密度收紧（2026-09-08）

### 这次改什么、不改什么

**改**：字号、padding、gap/留白、触控热区尺寸这四类，全部往 `user_compact_ui_preference.md` 记的紧凑基准靠拢。基准里有直接对应值的（卡片 padding 5/9px、卡片标题 12.5px、副信息 10px、Chip padding 3/9px + 11.5px、FAB 44×44px、Toolbar icon button 28×28px）优先直接照抄；基准没有直接给出的场景（比如"Hero 卡片这种全站独一份的大数字该多大"），下面每处都写清楚"这是我按基准精神做的判断,不是照抄"。

**不改**：色板十个 hex 值、Fraunces/Inter 两个字体家族、圆角尺度（12px/22px/pill）、emoji 图标语言这四件事这次原样不动——上面"视觉决定"里这四节除了"间距密度"被推翻之外，其余照旧。这次是纯粹的尺寸手术，不重新讨论调性。

**依据**：本次改动前实读了 `app/trips/[tripId]/page.tsx`、`wallet-grid.tsx`、`expense-list.tsx`、`exchange-record-list.tsx`、`fx-compare-list.tsx`、`fx-rate-card.tsx`、`record-expense-fab.tsx`、`app/globals.css`、`tailwind.config.ts` 的实际代码，下面每一行"改动前"都是这次读到的真实 Tailwind class，不是凭印象编的。

### 净额卡片（Remy 点名的具体元素，`app/trips/[tripId]/page.tsx` 第 85-101 行）

这是这次问题的核心，单独说清楚：

- **数字本身**：`font-serif text-5xl font-medium tabular-nums tracking-tight sm:text-6xl`（48px，网页宽屏 ≥640px 时变 60px）→ **`font-serif text-3xl font-medium tabular-nums tracking-tight`（固定 30px，去掉 `sm:text-6xl` 这个响应式断点）**。
  - 去掉响应式放大这条很关键：Remy 是"手机+网页两端"都反馈"太夸张"，网页端看到的正是 `sm:` 断点触发后的 60px 版本——光缩小手机端的基础字号，网页端不会一起变好。这次直接删掉断点，两端看到同一个尺寸。
  - 30px 这个数字不是抄基准来的（基准里没有"Hero 大数字该多大"这一条），是我的判断：这一行数字依然要保持全站最大字号（比行程标题 20px、比任何列表行数字 12.5-16px 都大），继续担着"余额优先"这个信息层级里最显眼的角色；但不需要靠 48-60px 的悬殊差距才叫优先——第一版/二版时期这一栏本来就是靠独占一行 + 财务语义色（emerald/red）+ `font-medium` 字重来突出，不是靠字号堆到快占满一屏宽度。
- **卡片容器 padding**：`p-5`(20px) → `p-4`(16px)。
- **内部元素间距**：`gap-3`(12px) → `gap-2`(8px)（"我的净额"标签、数字、副标题、"查看结算明细"链接这四行的垂直间距收紧）。
- **"我的净额"标签**（`text-xs uppercase tracking-wide`）：12px，不动——这行本来就不大，不是问题所在。
- **副标题"该收回/该付出 · N 笔消费"**：`text-sm`(14px) → `text-xs`(12px)。这里没有直接照抄基准的 10px，是我的判断：这两行文字是深色卡片（`bg-ink`）上唯一的行动线索，10px 配浅灰字在深底上可读性会打折扣，折中到 12px。
- **"查看结算明细 →"链接**：同上，`text-sm`(14px) → `text-xs`(12px)。

### 页面标题 / 分节标题

- **行程标题 `trip.name`**（page.tsx 第 79 行）：`text-3xl font-semibold`(30px) → `text-xl font-semibold`(20px)。理由：净额数字砍到 30px 之后，如果行程标题还留在 30px，两者同尺寸会分不出谁是页面的视觉焦点；20px 依然清楚地读作"标题"量级，但让位给净额数字。
- **"本位币 XX · 记账中"副标题**（page.tsx 第 80-82 行）：`text-sm text-muted`(14px) → `text-[10px] text-muted`，`mt-1`→`mt-0.5`。直接对齐基准"副信息 10px"，这是纯说明性文字，10px 完全够读。
- **四个分节标题**（"我的钱包"/"参与者"/"活动流"/"换汇 · EXCHANGE"，page.tsx 第 107/133/164/183 行，均为 `text-sm font-semibold text-slate-700`14px）→ **统一改成 `text-[12.5px] font-semibold text-slate-700`**，直接对齐基准"卡片标题 12.5px"——这几个 h2 起的作用就是给下面一个内容区块定标题，跟基准里"卡片标题"是同一类元素。
- **"仅自己可见"标注**（钱包/换汇两处，page.tsx 第 108/184 行）：已经是 `text-[10px]`，跟基准精确吻合，**不用改**。
- **fx-rate-card.tsx 标题"💱 当前汇率比价"**（第 80 行 `text-sm font-semibold`14px）→ `text-[12.5px] font-semibold`，跟上面四个分节标题统一成同一档。
- **"展开 ▲ / 收起 ▼"**（第 81 行 `text-xs`12px）→ `text-[10px]`。

### 列表行——消费记录 / 换汇记录 / 参与者（三处共用的密度问题）

这三处目前字号普遍靠 `.tx-item` 这个共用容器类继承 `text-base`(16px)，是除了净额数字外第二大的"占位子"来源。

**`app/globals.css` 里 `.tx-item` 定义**（第 40-42 行 `flex items-center gap-3 rounded-xl border border-sand bg-paper px-3 py-2 text-base`）：
- `px-3 py-2`(横 12px / 竖 8px) → **`px-[9px] py-[5px]`**——直接照抄基准"卡片 padding: 5/9px"这条，这三处清单行正是基准描述的"卡片"这个量级。
- `gap-3`(12px) → `gap-2`(8px)。
- 容器级 `text-base`(16px) 拿掉，改由每个子元素各自定字号（下面按元素拆开写），不再靠容器统一撑大字号。

**消费记录**（`expense-list.tsx`）：
- 类别名（第 98 行 `font-medium`，继承容器 16px）→ `text-[12.5px] font-medium`。
- 副标题"代垫人 · 日期 · 有收据"（第 99-102 行 `text-xs`12px）→ `text-[10px]`。
- 金额（第 106 行 `font-serif tabular-nums`，继承容器 16px）→ `font-serif text-[12.5px] font-medium tabular-nums`——跟类别名同一档，靠 `font-serif` + 后续可加的财务色区分身份，不靠字号更大。
- 编辑/删除图标按钮（第 78/87 行 `min-h-[44px] min-w-[44px]`，内部 `h-4 w-4`16px 图标）→ **`min-h-[28px] min-w-[28px]`**，直接照抄基准"Toolbar icon button: 28×28px"——这两个正是基准点名的那类"小图标操作按钮"，44px 是给主操作/FAB 用的量级，不该套在这种次要行内操作上；内部图标保留 `h-4 w-4`(16px)，28px 的框完全装得下。
- Avatar（第 68 行 `size={28}`）→ `size={24}`，跟下面参与者列表统一成同一个默认值。

**换汇记录**（`exchange-record-list.tsx`）：
- emoji 圆形图标底（第 34 行 `h-9 w-9`36px，`text-base`16px emoji）→ `h-7 w-7`(28px)，emoji 字号 `text-sm`(14px)——跟上面"toolbar icon 28px"这个量级统一，不用单独更大。
- 来源→去向文字（第 40-42 行 `font-medium`，继承容器 16px）→ `text-[12.5px] font-medium`。
- 副标题（汇率/日期/备注，第 43-46 行 `text-xs`12px）→ `text-[10px]`。
- 金额（第 48-50 行 `font-serif text-base font-medium`16px）→ `font-serif text-[12.5px] font-medium`。

**参与者列表**（`page.tsx` 第 134-160 行）：
- `<ul>` 容器 `p-3`(12px) → `px-[9px] py-[5px]`，跟上面 `.tx-item` 同一套基准值（这个容器本身不是 `.tx-item`，但性质一样，是清单容器，一并改）。
- 每行 `<li>` 的 `gap-3`(12px) → `gap-2`(8px)，`py-1`(4px) 保留。
- 参与者姓名（第 142-144 行 `text-base`16px）→ `text-[12.5px] font-medium`。
- "创建者"标注（第 144 行 `text-xs`12px）→ `text-[10px]`。
- "已认领/邀请待认领"（第 146 行 `text-xs`12px）→ `text-[10px]`。
- "我自己"（第 149 行 `text-sm`14px）→ `text-[12.5px]`，跟姓名同一档对齐。
- 该收/该付净额（第 151-155 行 `font-serif tabular-nums text-base`16px）→ `font-serif tabular-nums text-[12.5px] font-medium`。
- Avatar（第 140 行未传 `size`，用组件默认值 `32`）→ 显式传 `size={24}`，统一全站头像尺寸。

### 钱包卡片（`wallet-grid.tsx`）

- 卡片容器（第 92 行 `w-[136px] p-3`12px）→ **`w-[120px] px-[9px] py-2`**（宽度我的判断：内容字号整体收紧后 136px 显得空，收到 120px 让横向滚动那一排在同样屏宽下能多露半张下一张卡，提示"还能划"；padding 竖向留 `py-2`(8px) 没有压到 5px，是因为这张卡有三行内容叠着，压太死行距会挤）。
- 图标+钱包名那行（第 93-96 行 `text-[10px]`）——已经跟基准"副信息 10px"精确吻合，**不用改**。
- 余额数字（第 97-99 行 `font-serif text-lg font-medium tabular-nums`18px）→ `font-serif text-base font-medium tabular-nums`(16px)。判断：这是页面上第二重要的数字（仅次于 Hero 净额），保留比清单行数字（12.5px）大一档，但从 18px 降到 16px，不再跟 Hero 数字挤在同一个"很大"的量级里。
- 币种/绑定支付方式小字（第 100/102 行 `text-[10px]`）——已吻合，不动。
- "+ 新建钱包"占位卡的 ＋ 号（第 111 行 `text-2xl`24px）→ `text-xl`(20px)，跟卡片整体收紧的比例一致。
- 表单里的 emoji 选择按钮（第 173 行 `h-8 w-8`32px `text-base`16px）→ `h-7 w-7`(28px)，直接对齐"Toolbar icon button 28×28px"。

### 比价卡片（`fx-compare-list.tsx`）

- 卡片 padding（第 33 行 `p-3`12px）→ `px-[9px] py-2`(8px)——这里没有压到 5px，因为每张卡片有两行内容（渠道名+徽章 / 汇率细节），跟钱包卡同样的理由留了 8px 竖向呼吸。
- `gap-1`(4px) 保留不变。
- 渠道名（第 40 行 `text-sm font-semibold`14px）→ `text-[12.5px] font-semibold`。
- "最划算"徽章（第 43-46 行 `text-xs`12px，`px-2 py-0.5`）→ **`text-[9.5px] px-[9px] py-[3px]`**，直接照抄基准"Tag mini font: 9.5px" + "Chip padding: 3/9px"——这个徽章本质就是一个 tag/chip，不是普通说明文字。
- 金额（第 49-53 行 `font-serif text-lg font-medium`18px）→ `font-serif text-base font-medium`(16px)，跟钱包卡余额同一档（页面里第二级重要数字）。
- 汇率/手续费细节（第 55-61 行 `text-xs`12px）→ `text-[10px]`。

### 全局共用组件（`app/globals.css`）

这几个 class 全站到处复用（包括 settlement/invites/payment-methods 这几个这次没单独列改动点的次要页面），改这里能顺带把没点名的页面也一起收紧：

- **`.btn-primary`**（第 16-18 行 `min-h-[44px] px-4 text-base`）→ **`min-h-[44px]` 不动**，44px 是基准里 FAB 的量级，主 CTA 按钮跟 FAB 同级别，不用往下砍；`px-4`(16px)→`px-[14px]`，`text-base`(16px)→`text-sm`(14px)，视觉更紧但触控框不变。
- **`.btn-secondary`**（第 21-23 行 `min-h-[44px] px-3 text-sm`）→ **`min-h-[36px]`**（次要动作不该跟主 CTA/FAB 抢同一个高度，拉开一级），`px-3`/`text-sm` 不变。
- **`.tap-link`**（第 26-28 行 `min-h-[44px] px-1`）→ **`min-h-[32px]`**。这是纯文字链接（"查看结算明细→"、"取消"这类），不是独立按钮块，44px 强制触控热区在信息密度高的清单页面里会在文字周围留出大片空气；32px 仍满足基本可点性，不会像 44px 一样明显占位。
- **`.field-label`**（第 30-32 行 `text-base`16px）→ `text-sm`(14px)。
- **`.field-input`**（第 34-36 行 `px-3 py-3 text-base`）→ `px-[9px] py-2 text-sm`（横 9px 对齐基准，竖向留 `py-2`(8px) 没压到 5px，因为这是要打字的输入框，太矮打字体验会变差；字号 16px→14px）。
- **`.tx-item`**：见上面"列表行"一节，已单独写清楚。

### FAB（`record-expense-fab.tsx`）

- 容器 `min-h-[44px]`——**不动**，这是全站最高优先级的常驻主操作，44×44 这个量级本来就直接对应基准"FAB: 44×44px"，第三版这里反而是做对的，不用改。
- 文字"记一笔消费"（第 26 行 `text-base`16px）→ `text-sm`(14px)。
- `Plus` 图标（第 28 行 `h-5 w-5`20px）→ `h-4 w-4`(16px)。
- 这两处只是让 FAB 内部视觉更紧凑，不改变 44px 的触控框本身。

### 汇率比价条（`fx-rate-card.tsx`）

- 卡片容器（第 78 行 `p-4 sm:p-5`16→20px）→ **`p-4`**，去掉 `sm:p-5` 这个响应式放大——跟 Hero 净额卡同一个理由，网页宽屏不该比手机端更松散。
- 币种切换 chip（第 92 行 `rounded-full px-3 py-1 text-sm`14px，`py-1`4px）→ **`px-[9px] py-[3px] text-[11.5px]`**，直接照抄基准"Chip padding: 3/9px / font 11.5px"，这是项目里唯一现成的 chip 元素，精确对齐。
- 提示文字"先去…加几张卡/现金"（第 128 行 `text-sm`14px）→ `text-xs`(12px)。
- 错误提示（第 137 行 `text-base`16px）→ `text-sm`(14px)。

### 数值速查表（改完之后，方便 frontend-dev 对照/ui-auditor 验收）

| 用途 | 改前 | 改后 |
|---|---|---|
| Hero 净额数字 | text-5xl(48px) → sm:text-6xl(60px) | text-3xl(30px)，无响应式断点 |
| 行程标题 | text-3xl(30px) | text-xl(20px) |
| 分节/卡片标题 | text-sm(14px) | text-[12.5px] |
| 清单行主文字/数字 | text-base(16px) | text-[12.5px] |
| 次级数字（钱包余额/比价金额） | text-lg(18px) | text-base(16px) |
| 副信息（日期/汇率细节/币种） | text-xs(12px) | text-[10px] |
| Chip（币种切换/最划算徽章） | text-xs~sm(12-14px)，px-3 py-1/0.5 | text-[9.5-11.5px]，px-[9px] py-[3px] |
| 清单/卡片容器 padding | p-3(12px) | px-[9px] py-[5-8px] |
| Hero/汇率条 容器 padding | p-5 / p-4~sm:p-5(20px) | p-4(16px)，无响应式放大 |
| 主要元素间 gap | gap-3(12px) | gap-2(8px) |
| 主 CTA / FAB 触控高度 | min-h-44px | 不变（本来就对） |
| 次要按钮触控高度 | min-h-44px | min-h-36px |
| 纯文字链接触控高度 | min-h-44px | min-h-32px |
| 行内小图标操作按钮 | min-w/h-44px（16px 图标） | min-w/h-28px（16px 图标不变） |
| 头像 | 32px 默认 / 28px 局部 | 统一 24px |

## 逐区块改动点（这轮新增范围）

> 以下是第三版写的功能落地方案（钱包/换汇/比价三块的信息架构与交互判断），这轮补丁不改这里的架构决定，具体尺寸以上面「第四版补丁」为准，这里保留原文供参考。

### 我的钱包——卡片网格（新增区块）

**位置**：Hero 净额卡片下方，参与者列表之前。理由：钱包是"我自己的钱在哪张卡/现金里"，跟 Hero 卡片同属于"我自己看到的信息"；参与者列表是"跟别人的关系"，信息性质不同，分开摆放。

**私有标注**：区块标题旁边加一行小字"仅自己可见"（`text-[10px] text-[#8A7A6A]`），呼应 CLAUDE.md 里"钱包信息私有"这条产品设定，避免用户误以为钱包会被同行人看到。

**布局**：横向可滚动一行（`flex gap-3 overflow-x-auto -mx-4 px-4 pb-1`），不是网格换行。理由：钱包数量因人而异，数量一多网格会挤爆版面，横向滚动能优雅容纳任意数量，且隐含"划一下还有更多"的提示，跟 remy-thailand mwallet-scroll 同一个理由。

**卡片规格**：`w-[136px] shrink-0 rounded-xl border border-[#EDE8DA] bg-[#FEFCF7] p-3`（sand 边框 + paper 底，跟 remy-thailand mwcard 一致的"统一容器"手法，层级靠内容不靠盒子形状）。**（第四版补丁：宽度/padding 已改成 `w-[120px] px-[9px] py-2`，见上面「钱包卡片」一节，这里的 136px/p-3 是第三版原始值，已不是当前值）**内容从上到下：
1. emoji 图标（新建钱包时用户从预设列表挑，比如 🏦💵🌐📱🟠💳，没挑就给默认 💰）+ 钱包名称同一行，`text-[10px] font-bold uppercase tracking-wide text-[#8A7A6A]`，超长截断
2. 余额数字：`font-serif text-lg font-medium tabular-nums`（Fraunces）**（第四版补丁：改成 `text-base`，见上）**
3. 币种代码小字：`text-[10px] text-[#8A7A6A]`

**末尾追加一张"+ 新建钱包"卡**：同宽度，`border-dashed border-[#EDE8DA]`，居中一个大号 ＋，点击进新建钱包表单（名称/币种/初始余额/emoji 选择）。这是 trip-expense-ledger 特有的入口，remy-thailand 没有（它钱包写死不可扩展），照抄视觉但补上这个入口，见"绝对禁止"第 10 条。

### 取款/换汇——表单页面

**架构判断**：延续项目现有的"独立路由页面"模式（跟 `expense-form.tsx` 走 `/expenses/new` 一致），**不引入 remy-thailand 那种 bottom-sheet modal**。理由：bottom-sheet 是 remy-thailand 作为纯前端单页 App 的实现选择，trip-expense-ledger 是 Next.js 多路由 App，已有表单都是独立页面而非浮层，引入 modal 是架构改动不是视觉决定，这份简报只出视觉方向，架构判断留给 frontend-dev，这里明确建议"不用为了像 remy-thailand 而新增一套 modal 组件"。

**来源/目标钱包选择器**：两组选择按钮，直接照搬 remy-thailand `wpick-btn` 的交互规格——`grid grid-cols-2 gap-2`，每个选项 `h-11 rounded-xl border border-[#EDE8DA] text-sm font-medium`，选中态整个反色 `border-[#1A1A2E] bg-[#1A1A2E] text-[#FEFCF7]`。来源钱包允许不选（表示"纯充值无来源"）。

**动态展开的金额输入框**：选中来源/目标后，展开两个金额输入框（来源金额 + 目标金额，两者相除算隐含汇率，不直接填汇率数字），`grid grid-cols-2 gap-3`，每个 `rounded-xl border border-[#EDE8DA] bg-[#FEFCF7] h-11 px-3 font-serif text-lg`（数字用 Fraunces），中间用一个"→"字符做视觉连接（继续用字符不新增 lucide，呼应"图标"这条纪律）。

**日期 + 备注**：两列，复用现有 `.field-input` 样式。

**保存按钮**：`rounded-full bg-[#1A1A2E] text-[#FEFCF7]`（不是 amber，见色板决定）。

### 换汇记录——列表呈现

**位置判断**：不新增顶层导航 tab（第二版刚把首页精简成 4 段，不该再膨胀），挂在"消费活动流"区块下方，作为第二个 `sec-title`——"换汇·EXCHANGE"，跟"记录·HISTORY"并列。

**私有性判断（未确认，标注清楚）**：任务描述只说了钱包私有，没有明说换汇记录本身是否私有。我的判断是换汇记录应该跟着钱包走私有属性（否则会通过换汇记录反推出别人钱包里的余额变化），但这条**是我的判断，没有跟 Remy 确认过**，实现前建议先问一句。

**卡片视觉**：跟消费记录共享同一套 `tx-item` 容器（`rounded-xl border border-[#EDE8DA] bg-[#FEFCF7] p-3 flex gap-3`），靠图标底色区分类型——换汇记录用 `bg-[#F5EDD0]`（gold-lt）圆形图标底 + 🔁 或 💱 emoji，跟消费记录的图标底色区分开。中间文字："来源钱包名 → 目标钱包名"（无来源就写"充值 → 目标钱包名"），小字副标题显示隐含汇率（比如"1 MYR ≈ ฿8.13"）+ 备注。右侧数字：目标金额，`font-serif text-base font-medium tabular-nums`。**（第四版补丁：`.tx-item` padding/gap 及各文字字号已改，见上面「列表行」一节）**

### 比价卡片——视觉权重升级

**现状**：`app/trips/[tripId]/expenses/expense-form.tsx` 里 `recommendations` 渲染成扁平 `<ul><li>` 列表，每行 `flex items-center justify-between rounded px-2 py-1`，最优项只有一个 `bg-emerald-50` 底色 + Check 徽章，其余渠道的手续费/汇率细节完全没显示。

**目标结构**：每个渠道升级成独立卡片，纵向堆叠：
- 非最优：`flex flex-col gap-1 rounded-xl border border-[#EDE8DA] bg-[#FEFCF7] p-3`
- 最优：`bg-[#D0F0E5] border-[#2DAA85]`（seafoam 语义，跟"该收"用的 emerald 分开，见色板决定）
- 卡片顶部一行 `flex items-center justify-between`：左边渠道名 `text-sm font-semibold` + 最优徽章（继续用现有 `Check` lucide 图标，不用为了"统一成 emoji"返工）；右边金额 `font-serif text-lg font-medium tabular-nums`
- 卡片下方一行细节说明：`text-xs text-[#8A7A6A]`，显示汇率/手续费明细（比如"汇率 8.073 · 手续费 0.7%"）

**（第四版补丁：以上字号/padding 已改，见上面「比价卡片」一节，架构和颜色语义不变）**

**数据可行性已确认**：`lib/domain/fx-recommendation.ts` 的 `FxRecommendationResult` 已经带 `effectiveRate` 字段，输入的 `FxPaymentMethodInput` 也已经有 `fxMarkupPercent`/`foreignTxnFeePercent`/`fixedFee`/`cashbackPercent`——这次视觉升级不需要动 domain 层，数据都在，只是没画出来。

## 跟系统里其它项目的关系

延续第二版判断：刻意不跟 Remy 系统内部项目（SUI 珠宝系统/gem-deploy 那套暗色金色调）的 design language 走，这次纠偏也不改变这条。remy-thailand 虽然也是 Remy 自己的项目，但这里参照它的原因跟"要不要跟内部系统统一"无关，是纯粹把它当"外部验证过好用的产品案例"来学，这次甚至比第二版更进一步（整套视觉系统平移而不只是几个手法），但性质没变。**第四版补丁额外接上另一条系统内关系——尺寸密度这个维度这次改成对齐 Remy 的紧凑基准（`user_compact_ui_preference.md`），这条基准同时也管着 schedule/remy-expense/sui-jewelry 等其它系统，trip-expense-ledger 这次是补上没接的这一环，不是另立一套。**

## 第二版 vs 第三版对照表

**保留（第二版判断，这次不变）**：
- 信息架构：Hero 净额卡 → 参与者净欠款清单 → 全行程活动流 → 浮动 FAB 这 4 段结构，完全不动
- Splitwise 参照：余额优先 + 头像箭头转账清单
- Apple HIG 44pt 触控热区
- `tabular-nums` 数字右对齐
- FAB 的隐藏逻辑（`usePathname` 判断）+ 安全区处理（`env(safe-area-inset-bottom)`）这两块工程实现，只是外观跟着新色板/新圆角调（`bg-accent-700` 改 `bg-[#1A1A2E]`，`rounded-full` 本来就对，不用再改）
- `emerald-600` = 该收 / `red-600` = 该付这条财务语义色

**推翻（第二版判断，这次明确改）**：
- "trip-expense-ledger 是工具类要克制，照搬 remy-thailand 暖色/衬线字体会显得山寨"——推翻，Remy 明确要求靠近 remy-thailand
- CTA 主色 `amber-700`——退休，改用 `ink #1A1A2E`
- "不加第二种展示字体"——推翻，新增 Fraunces，但严格限定只用在数字金额上（不能用在中文标题上，见绝对禁止第 6 条）
- "小圆角 `rounded-md`(6px) = 精确"——推翻，改用 remy-thailand 的 12-22px 量级 + pill
- "整站一个强调色，其余走灰阶"——推翻，改成五色语义分工（ink/gold/sand/coral/seafoam）+ 保留的财务色（emerald/red）
- "emoji 当图标要禁，用 lucide-react"——推翻，改成默认用 emoji，已接入的两处 lucide 保留不返工，不再扩编
- "每个新区块都套同一个白盒子是偷懒"——部分推翻：remy-thailand 证明"卡片容器统一（sand 边 + paper 底 + 同一圆角）"完全没问题，层级不需要靠发明新盒子形状，靠内容（icon/颜色/字号反差）就够。这次改成"容器可以统一，层级别只靠容器形状"

## 第三版 vs 第四版对照表（本次尺寸密度收紧）

**保留（第三版判断，这次不变）**：
- 色板十个 hex 值 + 语义分工（ink/gold/sand/coral/seafoam + emerald/red）
- Fraunces 只用在数字金额上、Inter 管中文标题和正文这条纪律
- 圆角尺度（12px 标准卡/22px Hero 卡/pill 按钮）
- emoji 默认图标语言，已接入的两处 lucide 不返工
- FAB / 主 CTA 按钮的 44px 触控高度（跟紧凑基准的 FAB 44×44 本来就吻合，第三版这处做对了）

**推翻（第三版判断，这次明确改，理由见上面「第四版补丁」整节）**：
- Hero 净额数字 `text-5xl sm:text-6xl`(48-60px)——推翻，改 `text-3xl`(30px) 固定不响应式放大，这是 Remy 直接点名的元素
- "本页最重要信息"的卡片 padding 放宽到 `p-4~p-5`(16-20px)——推翻，Hero/汇率条改回 `p-4`(16px) 且不响应式放大，钱包卡/比价卡改 `px-[9px] py-2`
- 行程标题 `text-3xl`(30px)——推翻，改 `text-xl`(20px)，把视觉焦点让给净额数字
- 分节标题/清单容器 `text-sm`(14px)——推翻，改 `text-[12.5px]`，对齐紧凑基准"卡片标题"规格
- 清单行文字/次要数字普遍 `text-base`(16px)——推翻，行主文字降到 `text-[12.5px]`，次级数字（钱包余额/比价金额）降到 `text-base`(16px)
- 副信息 `text-xs`(12px)——推翻，改 `text-[10px]`，对齐紧凑基准"副信息"规格
- 次要按钮/纯文字链接沿用主 CTA 同款 `min-h-[44px]`——推翻，按钮拆成三级（主 CTA/FAB 44px、次要按钮 36px、纯文字链接 32px），行内小图标操作按钮从 44×44 降到 28×28（对齐紧凑基准"Toolbar icon button"）
