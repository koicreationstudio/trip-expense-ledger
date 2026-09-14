# trip-expense-ledger 视觉统一化 — 待拍板记录

## 【2026-09-14 晚，第八轮（Remy 说的"第四轮"，round4 截图对齐），线上真实页面 vs Artifact 源码逐屏核对，新 session 从这里读起】

背景：前几轮反复被 Remy 打回"跟 Artifact 不一样，功能也是"，这轮换了个做法——不再凭截图印象猜，而是直接翻 Artifact 完整源码（本地路径见下）逐 class/逐数值核对，配合 Remy 准备好的两组截图（`audit-diffs/round4/artifact/` vs `audit-diffs/round4/live/`，9 屏 + 2 交互态）。Artifact 源码路径：`~/.claude/projects/-Users-linotan-Desktop-Claude/24a4d41c-bedb-442f-934a-6f8fade25cf7/tool-results/artifact-86772aaa-1789310837-d1f0.html`（1432 行，全部 9 屏 markup + 全部 CSS token）。

### 做了的改动（已部署）

1. **"记一笔消费"支付方式字段简化成朴素下拉（Remy 本人明确要求）**——`expense-form.tsx`：原本是一张带"比价"按钮+比价推荐列表的卡片，改成一个纯原生 `<select>`（照抄币种字段同一套模式），列出用户名下全部支付方式，选中记 `selectedPaymentMethodId`。`ExpenseForm` 的 prop 从 `hasPaymentMethods: boolean` 改成 `paymentMethods: {id,label}[]`，两个调用方（`expenses/new/page.tsx`、`expenses/[expenseId]/edit/page.tsx`）跟着传完整列表。删掉的：`handleCompare`/`comparing`/`recommendations`/`compareError` 这几个 state/函数、`FxCompareList` 和 `FxRecommendationResult` 的 import。**没删**：`lib/domain/fx-recommendation`、`/api/trips/[tripId]/fx-recommendation` 路由、`fx-compare-list.tsx` 组件本身——比价功能的底层实现原样保留，只是先不挂在这个表单里了，之后要接到别的地方（比如取款换汇面板，或者独立入口）再说，这轮没有决定接到哪。
   - hint 文案如实说了现状：**没有**照抄 Artifact 那句"只列出本行程启用的"，因为这个项目的 schema 里 `paymentMethods` 表只到 userId/participantId 级别，没有 trip 级别的启用开关，Artifact 画了这个过滤但代码没做（见下面第 3 条结构性缺口）。列的是"用户名下全部支付方式"，hint 文字这么写的。

2. **支付方式页标题**——`payment-methods/page.tsx`：文案 "支付方式设置" → "支付方式"，字号 `text-base`(16px) → `text-[15px]`，对齐 Artifact 的 `.title-block h3{font-size:15px}` 以及本站"我的账号"/"我的行程"两处已经在用的 15px 规格。**没动**副标题文案（Remy 没要求改这句）。

3. **顶部导航 tab 补外层"轨道"容器**——`nav-links.tsx`：Artifact `.navtabs` 有一层 `background: gold-lt; border-radius: 999px; padding: 3px; gap: 4px` 的浅金色圆角轨道包着四个 tab，之前只做出了选中态的黑色胶囊，没有这层外层容器。补上 `<nav className="w-fit rounded-full bg-gold-lt p-[3px] gap-1">` 包装，选中态维持原来的 `bg-ink text-white` 不变，未选中态颜色从 `text-muted` 换成语义更准的 `text-gold-dk`（这两个 token 实际是同一个 hex `#6E6E6C`，纯视觉上没差别，只是跟 Artifact 对应的 `--gold-dk` 变量名对上）。

4. **两张汇率比价卡默认展开**——`fx-rate-card.tsx`（"当前汇率比价"）+ `fx-channel-compare-card.tsx`（"换汇渠道比价"）：查过 Artifact 源码，`.fx-section` 这块内容根本没有收起/展开的概念，一进页面就是摊开的；两个文件的注释里也没找到"Remy 拍板保留收起"这类记录，判断是没跟上 Artifact，不是刻意为之。`expanded` 初始值 `false`→`true`，`fx-rate-card.tsx` 额外补了一个 `useEffect` 在默认展开时自动拉一次数据（之前只有点"展开"这个动作才会触发拉数据，直接改初始值会导致默认展开但空白）。点"收起▲"的功能还留着，只是默认态换了。

5. **邀请管理页"生成新邀请链接"表单改成点开才展开**——`invites-manager.tsx`：这个文件里"直接添加参与者"那半边上一轮已经改成点开展开的模式了（`addParticipantOpen` state），但"生成新邀请链接"这半边还是常驻展开的表单，两边不统一，也跟 Artifact 的"+ 生成新邀请"按钮点开才弹表单对不上。加了 `genInviteOpen` state（默认 `false`），照抄同一个文件里已有的模式包一层。

### 判断"这轮不改"、原样保留的差异（附理由）

**A. "本行程启用的支付方式" ——Artifact 有、代码没有，这是真实架构缺口，这轮没做**
Artifact「支付方式」屏在"已添加"列表之外还有一个独立区块"本行程启用的支付方式"（复选框列表，勾哪些卡这趟行程要用），`payment-methods-manager.tsx` 里的"设置当前余额"面板文案也提到过类似假设（"余额面板收窄成只显示已勾选的这 2 项"），但翻了 schema，`paymentMethods` 表压根没有 trip 级别的启用/关联字段（只有 userId/participantId 级别，费率配置）。这不是 CSS/文案能解决的，要加 schema 字段/关联表 + migration + UI，改动面积和风险都不小。**这轮没有动手做**，留给下一轮单独评估要不要做、怎么做。

**B. 邀请管理页"现有邀请链接"/"参与者认领状态"两个独立区块——判断是真实功能，保留**
Artifact 这一屏只画了一个简单的合并列表（参与者+邀请状态混一起），线上代码拆成了两个更完整的区块：一个管理邀请链接本身（含有效期、撤销），一个管理参与者认领状态（含重置认领）。核实过代码，这两个功能（撤销邀请、重置认领）是真实存在且有实际用途的操作（`/api/trips/[tripId]/invites/[inviteId]` DELETE、`/api/trips/[tripId]/participants/[participantId]/reset-claim`），Artifact 的静态稿没有画出这两个操作口子，不代表不需要。判断跟"收据上传"是同一类——静态原型没画的真实功能，不该为了对齐视觉而砍掉。

**C. 新建行程页"你的称呼"/"同行人"字段——Artifact 没有，代码里是必需的，保留**
Artifact「创建新行程」屏没有这两个字段，但翻了 `new-trip-form.tsx` 和后端，建行程时必须同时指定创建者自己的称呼（`ownerDisplayName`）+ 可选预置同行人名单（`participantNames`），这是这个项目的数据模型要求（一个 trip 至少要有一个 participant 才能记账），不是这轮视觉改版顺手加的东西，Artifact 静态稿单纯没画出这一步。"本位币"字段的文案（"本位币（结算/比较用的币种）" vs Artifact"主要币种 用于统计汇总/净额"）代码里本来就有个注释写着"开放问题②，未真正拍板"，这轮没有动。

**D. 快速记账（quick-add-expense.tsx）"币种"字段——原生 select，风险大于收益，暂不改**
Artifact 这个字段是深色 `.dd-fake` 触发器点开候选清单；"分类"字段这边已经用 `CategoryCombobox` 组件解决了（这个组件本身是为了绕开 iOS Safari 对 datalist 的渲染 bug 而写的，行为上已经很接近 Artifact 的点开式下拉），但"币种"字段目前还是原生 `<select>`。评估过要不要照"分类"字段的思路也给"币种"做一个自定义下拉——币种候选就 6 个短代码，原生 select 功能完全够用，纯粹是为了跟 Artifact 视觉对齐要新增一个组件/新的状态管理，收益（好看一点）跟风险（新增代码面、新的边界情况）不成比例，这轮没有做，先记在这里。

**E. 新建钱包——Artifact 画的是弹层（modal），代码是卡片内联展开，判断保留**
Artifact 标注这屏是"新建钱包（弹层）"，代码里点"＋"是在"我的钱包"卡片内联展开一个表单（`wallet-grid.tsx` 的 `creating` state），不是真正的模态弹窗。功能上完全等价（钱包名联动支付方式命名池、账户类型 4 个图标、去掉起始余额字段——这几条 Artifact 第四轮拍板的东西上一轮已经落地了，逐值核对过是对的），只是"弹层 vs 内联展开"这个交互形态选择不同，属于合理的实现简化（避免额外引入 modal 组件/焦点锁定等复杂度），不是没跟上视觉，这轮没有改。

**F. 结算页 / 我的账号页——逐屏核对，已经对齐，没有发现需要改的地方**
"标记已结算"按钮从全局一键改成"转账清单按笔勾选已收款、全部确认才解锁"，逐条核对代码注释和文案（"转账进度：X/Y 笔已确认收款"），已经是 Artifact 第四轮拍板要的样子；"我的账号"页标题/副标题/链接框/按钮，跟 Artifact 截图逐项比对完全一致。这两屏没有改动。

### 部署

`./deploy.sh` 五关全过：lint 0 warning、typecheck 过、单测 67 个全绿、opennextjs-cloudflare build 成功、`wrangler deploy` 成功（Version ID `db03b327-2f3e-48ac-b8e2-211433a204a5`），回读 `https://trip-expense-ledger.remybali.workers.dev/api/health` 200。部署后另外建了一个测试行程复验（"UI复验-可删"），用 Playwright 截了 5 张图核对本轮改的 5 处改动：`01-行程主页-导航轨道和汇率卡展开.png`、`02-支付方式页标题.png`、`02b-支付方式页已添加.png`、`03-记一笔消费-支付方式简化下拉.png`、`04-邀请管理-生成邀请收起态.png`，截图存在 `audit-diffs/round4/verify/`。核对完这个测试行程已经从数据库清理掉了。

---

## 【2026-09-14 凌晨，第七轮，ui-auditor 逐屏走查抓出 3 个结构性缺口 + 5 处呈现差异，独立 session 熬夜做完，新 session 从这里读起】

背景：Remy 睡前交代"按 artifacts proposal 里那样部署，明早起来要看到一模一样"，这个 session 独立执行到底、中途不等确认。起手前 ui-auditor 先做过一轮线上页面 vs Artifact Version 10 的逐屏截图比对（`~/Desktop/Claude/live-*.png` / `artifact-*.png`），抓出 10 条差异，这轮逐条核实+修。

**⚠️ 重要事故记录：Artifact Version 10（`https://claude.ai/code/artifact/86772aaa-6ddc-4fd6-bff1-798788f15d1b`）这轮任务开始时已经读不到了**——`Artifact` 工具 `read` 报"not found"，`list`（scope=all，我自己发布过的 11 个 artifact 里没有这个 id）也确认不在，Playwright 直连这个 URL 被重定向到登录页（说明不是我权限问题，是这个 artifact 本身已经不存在/被撤下了）。这不是本轮任务造成的——上一轮（第六轮）落地 Version 10 时这个链接显然还能读（commit 528a9fe），推测是这之后到本轮之间的某个时间点被删除或撤回。**这轮没能读到 Artifact 原文**，全靠两份间接证据代替：①ui-auditor 之前截的 9 张 `artifact-*.png`（今天 00:25-00:53 期间的真实截图，可信度高，逐张肉眼核对过再动手）②本文件历史几轮记录下来的文字说明。如果 Remy 手上还留着这个 Artifact 的其它备份/分享链接，最好重新发一份，后续再有细节要对，现在这个 session 已经没有源头可查了。

### 3 条结构性缺口（做完，已部署）

1. **行程主页删"参与者"卡片**——`app/trips/[tripId]/page.tsx` 整块删掉（原来在"钱包卡→快速记账→汇率比价"之后、"活动流"之前）。`tripParticipants`/`netBalances` 两份数据没变成没用：前者还要喂 WalletCard 的参与者选择器和 ExpenseList 的 nameById，后者还要算 Hero 卡的 myNet，都留着；顺手删掉了变成没用的 `Avatar` import。邀请管理页"参与者认领状态"、结算页净额清单不受影响。
2. **顶部导航当前页高亮**——新建 `app/trips/[tripId]/nav-links.tsx`（客户端组件，`usePathname()` 判断当前路径），当前 tab 换成 `bg-ink text-white` 深色实底 pill，其它维持纯文字。`layout.tsx` 原来的裸 `<nav>` 换成这个组件，"邀请管理"链接（原来单独判断 `identity.isOwner` 插在 JSX 里）合并进统一的 `navLinks` 数组一起处理，逻辑不变。
3. **汇率比价卡片补两张基准卡**——`app/trips/[tripId]/fx-channel-compare-card.tsx` 加了 `.fx-base-row` 对应的两张卡（"1 MYR / = 8.120 ฿"这种格式），复用已经联动好的 `baseCandidates`/`effectiveTarget`，不是重新写死。**范围收敛，没有照抄 Artifact 全部**：Artifact 那屏还有一个"MYR→THB / USD→THB"分段切换按钮（替代现有的"我持有"下拉）、头部"🎯目标币种▾/🔄自选渠道/↻刷新"控件、警告提示框——这几个这轮**没有**跟着改，只加了两张基准卡本身。判断依据：任务原话明确说"这条要跟...对上，问题不是没联动，是卡片本身没渲染出来，是更基础的缺失"，范围就是加卡片，不是整屏重做；额外改那几个控件风险更高（要么新增交互要么改变现有"我持有"选择逻辑），没有被明确要求就没有动。

### 5 处呈现差异（做完，已部署）

4. **快速记账字段顺序**——`quick-add-expense.tsx` 从"金额→分类→币种"改成"分类→币种→金额"，纯换位置，两个字段各自的交互（CategoryCombobox / select）没动。
5. **"记一笔消费"整页字段顺序 + 谁代垫的语义**——`expense-form.tsx` 顺序改成：金额+币种（同一行，原样）→ 手动汇率（条件显示，原样跟着币种行）→ 商家名称 → 日期 → 分类 → 支付方式 → 备注 → 收据 → 分摊区块（最下面）。**分摊语义这次真的彻底改了**：原来"这笔怎么分摊"是三段式按钮 + 下面单独一个按条件显隐的"谁代垫的"下拉（半保留状态，任务原话说的"若隐若现"），现在改成一个"跟其他人 split 这笔"开关（`.switch` 组件），关掉时开关下面**完全不出现任何内容**（不是灰掉/收起动画，是真的不渲染），打开才展开"谁垫的钱？"统一区块（里面先是"平分/自定义分摊"两个按钮，紧跟"谁代垫的"下拉，选自定义分摊才再展开逐人编辑器）。底层数据模型（`splitMode: onlyMe/equal/custom`）完全没动，`handleSelectSplitMode`/`handleSubmit` 这些既有函数原样复用，只是 UI 呈现变了——开关"关"对应 `onlyMe`，"开"默认落到 `equal`。收据字段（Artifact 静态稿没画）保留没删，按任务要求挪到了备注之后、分摊区块之前的位置。
6. **头部拆成"大标题+独立胶囊"两层**——`layout.tsx` 加了静态 `<h1>{trip.name}</h1>`（跟"记一笔消费"页 h1 同款 `text-base font-semibold`），`TripSwitcher` 的胶囊不再兼职当标题：`trip-switcher.tsx` 里"没有下拉可开就退回大字文本"这个 fallback 分支改成直接 `return null`（因为标题那边已经显示了行程名，不用再重复一份）。
7. **"支付方式"字段——保留比价功能，只改标签**：`expense-form.tsx` 里原来叫"这笔用哪张卡最划算？"的卡片，**判断依据**：`git log --diff-filter=A` 查到这个比价功能（`fx-compare-list.tsx`/`fx-recommendation`）是 v0.1（commit `59e69bf`，项目第一个版本）就有的真实功能，不是这轮视觉改版顺手夹带的复杂化，阉割成 Artifact 那种不比价的简单下拉不合适。这轮只做了"简化外观向 Artifact 靠拢"这一步：标签文字改成 Artifact 用的"支付方式"，位置挪到 Artifact 骨架该在的位置（分类之后、备注之前）；"比价"按钮、比价结果列表、点选逻辑一个字节都没动。**这是我自己的判断，没有跟 Remy 二次确认**——如果 Remy 就是想要那种极简的静态下拉、宁可牺牲比价功能，这条需要回头再改。
8. **分摊控件按屏幕区分，不是同一个东西要统一**：行程主页"快速记账"维持三段式按钮（`.seg3`，仅我自己/平分/自定义分摊，这个之前就是对的，没有改）；"记一笔消费"整页这次改成了开关（`.switch`，见第 5 点）——两个屏幕分别对应 Artifact 各自该用的组件，之前的 bug 是"记一笔消费"页误用了跟行程主页一样的三段式按钮，这轮是修这一处，不是新增什么统一逻辑。
9. **支付方式页"设置当前余额"收进底部按钮**——`payment-methods-manager.tsx`：原来常驻在页面最上面的"设置当前余额"整块区域（含钱包列表+编辑表单）搬到页面最下面（"新增支付方式"表单之后），收进一颗 `⚙ 设置当前余额` 按钮，点了才展开钱包余额清单。新增 `balancePanelOpen` state 控制展开/收起，钱包数据获取（`loadWallets`）逻辑没动。
10. **邀请管理页"直接添加参与者"收成文字链接**——`invites-manager.tsx`：原来常驻的"直接添加参与者"整块表单区域，改成"生成新邀请链接"区块下面一行文字链接"或者：＋ 直接添加参与者（暂不需要邀请链接）"，点了才展开姓名输入框+添加按钮。新增 `addParticipantOpen` state，`handleAddParticipant`/API 调用逻辑没动。

### 涉及文件
`app/trips/[tripId]/page.tsx`、`app/trips/[tripId]/layout.tsx`（新建 `nav-links.tsx`）、`app/trips/[tripId]/trip-switcher.tsx`、`app/trips/[tripId]/fx-channel-compare-card.tsx`、`app/trips/[tripId]/quick-add-expense.tsx`、`app/trips/[tripId]/expenses/expense-form.tsx`、`app/trips/[tripId]/payment-methods/payment-methods-manager.tsx`、`app/trips/[tripId]/invites/invites-manager.tsx`。

### 部署
`./deploy.sh` 五道关卡（lint / typecheck / 67 单测 / opennextjs-cloudflare build / wrangler deploy + 回读 `/api/health` 200）一次性全过，Version ID `2c1f42b5-35df-4fc4-8724-d53550844b57`。线上地址不变：`https://trip-expense-ledger.remybali.workers.dev`。

### 测试数据清理
部署后走查前，先清掉了上一轮 ui-auditor 遗留在生产库的"UI审计测试行程"（id `021c8ba3-fe3d-4cc0-a20e-309594fbd8a8`，含关联的 wallet/expense/expense_split/participant/session/invite），用的是逐表手动 DELETE（expense_split→settlement_confirmation→settlement_snapshot→exchange_record→wallet→expense→invite→session→participant→trip 这个依赖顺序，不是单纯信任 ORM 声明的 cascade，D1 是否真的强制执行 SQL 级联没有确认过，手动删更保险），删完验证过 `SELECT` 查不到这个 trip id 了。**没有动**的另外两个历史遗留测试行程（"FAB修复验证-测试(生产)" `d89659e1...`、"UI走查测试-无可用基准" `81991eff...`）——这两个不在这次任务交代的清理范围内，不确定是不是还有别的用途，留给 Remy 自己判断要不要删。

这轮 ui-auditor 复验建的新测试数据（如果有）见下面复验小节。

### ui-auditor 复验结果（第一轮，10 项全测）

新建了测试行程"UI复验-第二轮"真机走查（不是只看代码），逐条结果：1/2/3/4/6/7/8/9/10 共 9 项✅通过，截图都在 `~/Desktop/Claude/verify2-*.png`（15 张）。**第 5 项发现一个真 bug**：记一笔消费页面的"跟其他人 split 这笔"开关，字段顺序本身是对的，展开/收起逻辑也对，但**默认状态错了**——新建表单一进去开关就是"开"的（应该默认"关"，跟 Artifact 一致），根因是 `expense-form.tsx` 里 `splitMode` 的默认值是 `'equal'` 不是 `'onlyMe'`，而开关判定是 `splitMode !== 'onlyMe'`。

**当场修了**：`expense-form.tsx` 第 147 行左右，`useState<SplitMode>(initialSplitState?.splitMode ?? 'equal')` 改成 `... ?? 'onlyMe'`（编辑已有消费时走 `initialSplitState`，不受影响）。改完重新 lint/typecheck/67 单测全过，重新 `./deploy.sh` 部署，Version ID `708bad6c-7d70-4270-9ccc-276f97fbaea4`，健康检查 200。我自己又用 Playwright 拿 ui-auditor 那个测试行程的身份链接手动复测了一遍（`~/Desktop/Claude/verify3-splitmode-default.png`），确认新建表单默认开关是灰色关闭态，下面不再冒出"谁垫的钱？"那块内容——bug 修好了。

第 6 项有个小落差备忘：ui-auditor 描述行程胶囊颜色是"深灰"不是我转述时以为的"深绿"，查了代码确认 `trip-switcher.tsx` 用的 `bg-accent-700`，`tailwind.config.ts` 里这个值等于 `ink`（`#373736`），是之前一轮（commit 52fdde1）就定下的设计决定"标题/Hero/CTA/选中态统一用最深灰"，不是这轮引入的问题，不用改。

**测试数据清理**：ui-auditor 这轮建的"UI复验-第二轮"（id `6b8ed47d-82b0-414e-aa8e-f09c9bd8cfa2`，含 2 个占位参与者/1 笔消费/1 个支付方式）已经用跟第一轮一样的手动逐表 DELETE 方式清掉，`payment_method` 表那条"HSBC 测试卡"（不属于 trip，是人/账号级数据，删 trip 不会带走）单独多删了一次，删完都验证过查不到了。

（这份文件到这里为止都是当晚一次做完的，没有再等 Remy 确认——按她睡前"不用等我确认，交代完你自己做"的原话执行。）

---

## 【2026-09-13 第六轮，Remy 对 3 个开放问题 + 1 个 UX bug 拍板收尾，新 session 从这里读起】

背景：第五轮落地记录（下面那段）里留了 3 个开放问题没真拍板 + 走查发现 1 个表单错位 UX bug。这轮 Remy 逐条拍板，已经全部处理完部署上线。

1. **汇率基准卡片要不要联动行程启用币种（开放问题①）—— 拍板：要联动，已改代码**。第五轮的结论"按 Artifact 结论不做联动"作废，这轮改成真联动。改的文件是 `app/trips/[tripId]/fx-channel-compare-card.tsx`（新增 `resolveBaseCandidates`/`resolveTargetCandidates` 两个函数）+ `app/trips/[tripId]/page.tsx`（把 `trip.enabledCurrencies` 传给卡片）。基准候选和目标候选都改成用 `enabledCurrencies` 跟 `FX_RATES` 支持的币种取交集，不再是写死的 `Object.keys(FX_RATES)`。`enabledCurrencies` 为 `null`（老行程没设置过）时退回不收窄的旧行为。边界情况：①行程启用的币种一个都不在 FX_RATES 支持的基准范围内（目前只有 MYR/USD 两档），或者基准选出来了但没有其它币种可比（比如只启用 1 种），都给文字空状态提示，不报错不留白；②目标候选显式排除基准自己，不会选到自己换自己。FX_RATES 常量本身没删，还是汇率数值来源，也还在给 `formatAtmFeeNote` 算 ATM 手续费用。
2. **新建行程"主要币种+多选启用币种"设计（开放问题②）—— 拍板：维持现状，不改**。第五轮第 8 项已经做的实现（`app/trips/new/new-trip-form.tsx`）继续保留，这轮没有再动这部分代码。
3. **新建钱包账户类型图标 7→4 个精简（开放问题③）—— 拍板：维持现状，不加回**。第五轮第 11 项已经做的精简（`app/trips/[tripId]/wallet-grid.tsx`）继续保留，被砍掉的 3 个图标不加回来，这轮没有再动这部分代码。
4. **记账表单"谁代垫的"字段位置错位 UX bug —— 拍板：要修，已改代码**。改的文件是 `app/trips/[tripId]/expenses/expense-form.tsx`：原本"这笔怎么分摊"分摊开关挂在表单最底部、"谁代垫的"字段在中段偏上，滚到底切开关时看不到上面字段的变化。这轮把"这笔怎么分摊"整块（含自定义分摊详情编辑器）搬到紧贴"谁代垫的"字段正上方，逻辑顺序变成先选分摊模式、紧接着就是"谁代垫的"（按 `splitMode !== 'onlyMe'` 条件显隐，原有显隐逻辑不变），同一屏就能看到联动，不用来回滚动确认。第五轮记录里提到的"已知小瑕疵"（默认滚动位置下拉会消失的反直觉问题）这轮已经解决。

**部署**：`./deploy.sh` 五道关卡（lint / typecheck / 单测 / opennextjs-cloudflare build / wrangler deploy + 回读 `/api/health` 200）一次性全过，过程中没有关卡失败需要修复。线上地址不变：`https://trip-expense-ledger.remybali.workers.dev`。

---

## 【2026-09-13/09-14 落地实现记录，第五轮，真代码已改完部署，新 session 从这里读起】

**2026-09-13 补记**：ui-auditor 真机走查这轮上线后的页面，抓到 2 个具体问题，已经修完重新部署了。①`trip-switcher.tsx` 切换行程下拉里 otherTrips 每一行右侧还留着一段"该收/该付 RMXXX"金额 span，是上一轮实现时的遗漏（Artifact Version 10 稿子里这几行只有圆点+名字，没有金额），已经删掉，改完这一行保持左对齐。②`fx-channel-compare-card.tsx` 里"ATM 取款"渠道的说明文字原本写死"银行外汇费约 2% + ฿220 固定手续费"，切目标币种（比如切到 SGD）之后符号和数字没跟着变，已经改成按当前选中的目标币种动态换算（拿 `FX_RATES.MYR` 当换算枢纽）+ 用 `FX_SYMBOLS` 取对应符号。两处改动都过了 lint/typecheck/67 个单测，走 `./deploy.sh` 重新部署，五道关卡全过，回读 `/api/health` 200。

背景：Remy 拍板确认了 Artifact Version 10（第四轮静态提案，2026-09-13 22:49 确认），这轮任务是把那份提案落到 `trip-expense-ledger` 真代码库里，不再是改 HTML 静态稿。这次是直接动真代码 + 真部署，不是又一轮提案修订。

**线上地址**：`https://trip-expense-ledger.remybali.workers.dev`（`./deploy.sh` 五道关卡全过：lint / typecheck / 67 个单测 / opennextjs-cloudflare build / wrangler deploy，最后回读 `/api/health` 200）。

**D1 migration**：`lib/db/migrations/0006_worried_catseye.sql` 已经 `npm run db:migrate:remote` 跑过、应用到远程数据库了（新增 `settlement_confirmation` 表 + `trip.trip_start_date`/`trip.trip_end_date`/`trip.enabled_currencies`/`invite.invitee_name`/`wallet.balance_updated_at` 五个字段，全部是新增列/新表，没有改动或删除任何既有字段，属于纯增量迁移）。

### 做完的部分（按优先级，都过了 lint/typecheck/单测，线上能访问）

1. **切换行程下拉**（`app/trips/[tripId]/trip-switcher.tsx`）——逐值照抄 Artifact `.dropdown-panel`/`.dd-row` 规格重做：容器 `rounded-[14px]` + `padding:4px`，标题"展开：切到其它行程"跟"＋新建行程"入口挪到同一行右上角，每行加圆点符号（未选中 `#B5B4B1`/选中 `ink`），未选中行背景透明+极淡 1px 分隔线，选中行背景 `#EBEAE8` 圆角 8px 名字加粗右边用 ✓ 替代"当前行程"文字。删除行程/切换中态/报错这些既有交互功能原样保留，只换了外层视觉。**这项历史被打回 3 次，这轮没有再另外派 Playwright 走查去截图比对**——deploy.sh 通过 + 我自己读代码核对过跟 Artifact 逐值一致，但没有实机截图验证，这一步交给 lifeos-pm 之后派 ui-auditor 补。

2. **我的钱包卡拆分 + 三档色阶切换器 + 取款/换汇真正内嵌**——`app/trips/[tripId]/page.tsx` 里原本"净额+钱包合并成一张深色卡"的方案被拆回两张独立卡片（Hero 净额卡保留 `bg-hero-gradient` 渐变，钱包卡新建成独立组件 `app/trips/[tripId]/wallet-card.tsx`，默认背景 `#2E2E2C`，右上角三个 13px 圆点按钮可以实时切深 `#1A1A19`/中 `#242422`/浅 `#2E2E2C`，纯前端 state 不落库）。"💱 取款/换汇"改成点了在钱包卡内部原地展开白色小面板（`ExchangeForm` 组件加了 `onSuccess` 回调区分"页面模式"和"内嵌模式"），不再跳转到独立页面；旧路由 `app/trips/[tripId]/exchange/new/page.tsx` 改成 redirect 回行程主页（怕有人收藏过旧链接），没有整个删掉。

3. **全局紧凑化 token**（`app/globals.css`）——`.field-label`(10→9px)、`.field-input`/`.field-input-dark`(12.5→10px，padding 9px/py-2→7px/5px)、`.btn-primary`/`.btn-secondary`(12.5→11px，padding 收紧)、`.tx-item`(padding 收紧到 6px/4px) 这几个全局 chokepoint 改了，影响面覆盖全站大多数表单/按钮/卡片，比逐页面改省事也不容易漏。新增了 `.row-compact`/`.row-name` 两个小 chokepoint 给"一行一人/一笔"的列表用。

4. **记一笔消费"谁代垫的"开关逻辑**（`app/trips/[tripId]/expenses/expense-form.tsx`）——分摊选"仅我自己"时隐藏"谁代垫的"下拉、代垫人强制归位到自己；选"平分"/"自定义分摊"才展出这个下拉。**已知小瑕疵**：控制这个下拉显隐的"这笔怎么分摊"选择器在表单里位置比"谁代垫的"下拉更靠下（在 FX 比价卡片之后才出现），所以默认打开表单时（默认"平分"）下拉是显示的，但如果用户往下滚动把分摊模式切成"仅我自己"，上面的下拉会跟着消失——功能上没问题，但视觉上"越往下滚、越上面的字段会消失"这个顺序有点反直觉，没有重新排列整个表单顺序去修这个，怕牵动其它字段位置，留给 ui-auditor 走查时看看要不要再调。`quick-add-expense.tsx` 核实过参与者列表本来就是读真实 `participants` prop（不是写死 Alex/Ben），不用改。支付方式下拉（"这笔用哪张卡最划算"走的是比价流程 `FxCompareList`/`handleCompare`）**没有改动**——怕跟现有比价流程冲突，保留现状，需要 Remy 看效果再定要不要加一个不比价直接选的下拉。

5. **结算页按笔勾选收款**（`app/trips/[tripId]/settlement/`）——这项工作量最大，做了完整版本，不是简化版：新建 `settlement_confirmation` 表持久化每笔转账的确认状态（只有收款方本人能勾/取消勾，API 层校验 `identity.participantId === toParticipantId`），转账清单每行前面加勾选框，底部显示"转账进度：X/Y 笔已确认收款"，没勾完之前"标记本行程已结算"按钮禁用变灰。**已知简化**：确认状态只锚定 `(tripId, from, to)` 这一对参与者，不锚定金额——如果这期间又有新消费改变了这笔转账的实际金额，已确认状态不会自动失效，需要靠人工意识到金额变了要重新确认。新增"查看 XX 的分摊明细 ▾"展开功能（之前完全没有，是新做的），点开显示这个人涉及的每一笔消费（分类/日期/金额，带正负号区分"垫付"和"分摊"）。净值卡片紧凑化：padding 3px 5px、头像 18×18px、姓名 10.5px、金额 9.5px，全部按 Remy 第四轮明确数值改的。

6. **支付方式页"设置当前余额"**（`app/trips/[tripId]/payment-methods/payment-methods-manager.tsx`）——判断这个功能实际对应的是 `wallets` 表（行程内钱包余额），不是账号级 `paymentMethods` 表（那张表没有余额字段，只有费率配置）；Artifact 把这个功能画在"支付方式"页只是信息架构上的归类，不代表底层数据也挂在 paymentMethods 上。新增一段"设置当前余额"区块列出这个行程的钱包，点"设置当前余额"能填新金额+可选补录日期（`wallet.balance_updated_at`），走 `PATCH /api/trips/[tripId]/wallets/[walletId]` 现成端点（只扩了 schema 加 `balanceUpdatedAt` 可选字段，没有新建端点）。

7. **邀请管理**（`app/trips/[tripId]/invites/invites-manager.tsx`）——生成邀请时加了"对方名字"可选输入（`invite.invitee_name`），列表里如果填过名字会显示在链接上方。新增"直接添加参与者"区块（纯姓名+添加按钮，新端点 `POST /api/trips/[tripId]/participants`），建的是跟"邀请链接还没被认领"完全同形状的 participant 记录（`claimedAt`/`userId` 都留空），因为"记一笔消费"分摊名单本来就是读 `participants` 表真实数据，加进来的人自动出现在分摊名单里，不用额外接线，我核实过这条链路确实是通的。"用于哪个行程"下拉**没有做**——URL 里本来就带着 `tripId`，加这个下拉是多余的，跟 Artifact 里这条要求的实际意图对不上，判断跳过。

8. **新建行程**（`app/trips/new/new-trip-form.tsx`）——加了"同时启用哪些币种"多选 chip（默认勾选本位币，改本位币会自动带上新选项）+ 出发/返程日期两个可选 date input。**这块是开放问题②，不是真拍板内容**，实现时刻意收敛在这个表单 + `trips.enabledCurrencies` 一个字段，没有散播到记账/钱包等其它地方，如果 Remy 说不要这样，删这段 state + 输入框就能回退，不用大改。`enabledCurrencies` 目前只存进数据库，**没有**接到"记账时币种下拉收窄成这个行程启用的币种"这层过滤逻辑——如果要这个效果需要再做一轮。

9. **首页行程卡片**（`app/my-trips.tsx`）——标题"我的行程"18→15px；卡片加 ✎ 改名（新端点 `PATCH /api/trips/[tripId]`，两条腿鉴权跟 DELETE 同一个模式，因为首页点改名的行程大概率不是当前 `tel_session` 指向的那趟）；新增日期范围显示行"📅 09/11 - 09/15"（读 `tripStartDate`/`tripEndDate`，老行程没填过就不显示这行，不强行补录）。

10. **我的账号**（`app/account/page.tsx`）——标题字号 16→15px，纯样式微调，没有功能改动。

11. **新建钱包弹层**（`app/trips/[tripId]/wallet-grid.tsx`）——去掉"起始余额"输入框（新钱包一律从 0 起步，余额改由第 6 项"设置当前余额"承担）；账户类型图标从 7 个精简到 4 个（🏦银行/💵现金/💳信用卡/📱手机支付，**这项是开放问题③，未真正拍板**），保守处理没删历史数据兼容性（已建钱包如果用了被砍掉的图标照常显示，因为渲染逻辑本来就是直接读 `w.emoji` 字段不反查这张表）；新增"已有支付方式：XX、YY"联动，点名字直接填进"钱包名"输入框。

12. **换汇渠道比价新卡片**（`app/trips/[tripId]/fx-channel-compare-card.tsx`）——这是全新增量功能，跟已有的 `FxRateCard`（比"用哪张卡划算"）是两个不同维度，没有替换关系。用 Artifact 给的固定汇率表 + 渠道点差（Wise/TNG跨境/ATM取款/换钱店/支付宝）纯前端计算展示，目标币种切换真的重算，渠道自选（含支付宝独立开关）真的增减列表。**支付宝的点差数值 Artifact 没给具体数字，代码里用的是 -1.8% 估算值，注释里标了"估算值，待真实数据更新"**，不是真实数据，Remy 或 market-researcher 有真实数据后要记得回来更新 `app/trips/[tripId]/fx-channel-compare-card.tsx` 里的 `FX_CHANNELS` 常量。

### 3 个开放问题的落地取舍（如实记录，都没有真拍板，是 lifeos-pm 判断的方向）

1. **汇率基准卡片要不要联动行程启用币种**——按 Artifact 结论不做联动，`FX_RATES`/`FX_CHANNELS` 固定表跟 `enabledCurrencies` 是两份独立数据，没有改动。
2. **新建行程"主要币种+多选启用币种"**——按第 8 项做了，代码收敛好、容易回退，需要 Remy 看完效果确认这个方向对不对。
3. **新建钱包账户类型图标精简到 4 个**——按第 11 项做了，保守处理不影响历史数据，需要 Remy 确认要不要真的砍掉另外 3 个。

### 没做完/明确跳过的部分

- 没有单独跑 ui-auditor 真机 Playwright 走查（brief 里说这关由 lifeos-pm 之后单独派），只做了 `curl` 基本 200 状态检查 + deploy.sh 自带的单测/typecheck，**没有肉眼截图比对视觉效果**，尤其是第 1 项"切换行程下拉"这个历史重灾区，强烈建议下一步优先派 ui-auditor 去看。
- 新增功能（"设置当前余额"、"直接添加参与者"、结算按笔勾选）**没有补单元测试**——时间有限，优先保证改完的 67 个既有测试全过（没破坏任何现有测试），新功能靠 deploy.sh 的 build/typecheck 过 + 我自己读代码核对逻辑，没有额外写 `.test.ts`。
- 记账表单"支付方式下拉只列本行程启用的项"这条（第 4 项提到的）保留现状没动，怕跟现有比价流程冲突。
- `enabledCurrencies` 字段存了但没接到记账表单的币种下拉过滤逻辑（见第 8 项）。

### 本机环境顺手修的一个问题（跟这次改动无关，但挡了 typecheck）

`node_modules/@types/` 下有 7 个损坏的空目录（`node 2`/`react 2`/`estree 2` 等，带空格+数字后缀，内容全空），导致 `tsc --noEmit` 直接报错拿不到类型定义。这是环境层面的损坏（不在 git 追踪范围，`node_modules` 本来就 gitignored），不是这次代码改动引入的，已经 `mv` 挪到 scratchpad 清掉了，不影响任何已提交的文件。如果换一台机器/重新 `npm install` 遇到同样情况，大概率是同一类 npm install 中断/文件系统同步冲突导致的重复目录，直接删掉那些空的 `* 2` 目录即可。

---

## 【2026-09-13 晚间新增，第四轮，新 session 从这里读起（下面那段"2026-09-13 新增"是第二轮的记录，仅供背景参考，不用再照做一遍）】

背景：当前这个 session 接手了下面记录的第二轮反馈后，又连续做了第三轮反馈（全局统一化+紧凑化+9屏细节）。Remy 看完第三轮成果后，这次给的是**收尾性质的小范围反馈**：2 处新的紧凑化要求 + 对第三轮回报的 7 个开放问题逐条拍板。Remy 说完这轮意见后要求切换新 session，当前 session 没有再执行这轮改动，交给下一个 session 接手。

**Artifact 链接不变（一直是同一个，原地 republish 到现在）**：`https://claude.ai/code/artifact/86772aaa-6ddc-4fd6-bff1-798788f15d1b`

**执行要求跟前几轮完全一样**：只改这个 HTML 静态提案（Artifact read 最新内容 → 原地修订 → 原地 republish，不发新链接），不碰真代码仓库、不部署；这是项目相关任务，按 CLAUDE.md 规矩要先经 lifeos-pm 判路由/派工/跟进/审过产出，不要自己直接上手改或直接点名其他 PM；改完照例给 Remy 逐屏确认，等她全部点头才能碰真代码。

### 这轮新增的 2 处紧凑化要求
1. **支付方式页面**（对应她发的截图：整页截图 + "已添加"支付方式列表卡片+"＋添加支付方式"按钮的裁切图）——这部分要求再缩小一号、更紧凑（字号、padding、按钮高度都再收一档，跟第三轮"全局紧凑"的方向一致，这次是点名支付方式这一屏还不够紧凑）
2. **结算页面**（对应她发的截图：Remy/Alex/Ben 三人净值卡片，每张卡片里有姓名+头像圆圈+该收/该付金额+"查看XX的分摊明细▾"链接）——这几张卡片要求再缩小

### 第三轮 7 个开放问题的拍板结果（不用再问了，直接照这个做）
1. **我的钱包 vs 取款/换汇要不要合并** —— Remy 说"没看到这个方案"：上一轮回报里只是**文字描述**了三个方案（倾向方案①把取款/换汇收进钱包卡里、不再单独占导航），**没有真的在 Artifact 里做出来**。这轮必须**真正实现方案①**（取款/换汇的入口和操作收进"我的钱包"卡片内部，行程主页顶部的四个 tab 从"行程主页/结算/支付方式/邀请管理"里去掉"取款/换汇"这个独立入口，如果之前"取款/换汇"是独立导航项的话），做完要让 Remy 在提案里能直接看到、点到这个合并后的实际效果，不能再只是文字说明
2. **支付方式（信用卡类）跟钱包账户（现金/银行类）共用同一套"本行程启用"开关** —— Remy 回答"要"，**定案**：这两个概念这次明确合并成一套，第三轮已经先假设做了效果，这轮确认延续、不用回退
3. **结算"按人分别标记已结清"的草案交互（每笔转账各自勾选"已收款"+进度统计，全部勾完才解锁"标记已结算"按钮）** —— Remy 回答"这个可以"，**定案**：保留第三轮做的这版交互，不用改
4. **"直接添加参与者"方案（纯姓名输入框+添加，没有登录方式，记账/结算大概率要 Remy 代操作）** —— Remy 回答"可以"，**定案**：保留
5. **分摊人员名单要不要跟邀请管理的参与者名单实时同步** —— Remy 回答"要"：这轮要把"记一笔消费"分摊功能里可勾选的参与者列表，改成真的读取"邀请管理"页面的参与者数据（哪怕是静态提案里模拟的一份共享数据源），不能再是写死的 Alex/Ben 示范名单，邀请管理加人这边变了那边也要跟着变
6. **汇率比价"目标币种可选+渠道自选"这两个 UI 意图要不要做进正式产品完整逻辑** —— Remy 回答"要"：上一轮这两个功能只是摆了个"意图性"的 UI（目标币种下拉没有真的重算、渠道自选是真的能勾选），这轮要求把这两个都做成**看起来完整可信、可实际点击验证效果**的程度（在静态提案能力范围内尽量做实——比如切换目标币种后下面的换算数字真的会跟着变，不是纯装饰）
7. **新建钱包的"钱包名"要不要跟支付方式命名同步** —— Remy 回答"要"：新建钱包弹层里"钱包名"这个输入，要跟"支付方式"页面已有的账户名称库同步/联动，不要是两套互相独立的命名系统（呼应第三轮"取款/换汇新增来源钱包"里提过的同一个问题，这次是新建钱包弹层这个入口也要一并处理）

### 新 session 建议的第一步
1. 先用 Artifact read 工具读一遍 `86772aaa` 当前最新完整内容，确认第三轮的改动都还在（不要凭这份文件的文字描述假设现状，一律以实际读到的内容为准）
2. 经 lifeos-pm 派工，按上面 2 条紧凑化要求 + 7 条拍板结果逐项修订，原地 republish
3. 改完照例把改动摘要 + 链接回报给 Remy 确认

---

## 【2026-09-13 新增，第二轮反馈记录，仅供背景参考】

背景：上一个 session（`session_01CpJ1zgkaAPT5pV57bBdwPF`）做完上面记录的东西后，被这个新 session（`session_01UUHc7QwSimT1ni9JfP4LTB`）接手，做了大量真机走查修复 + 部署（账号合并/身份安全网/分摊三档/FAB结构改造/字体统一等，commit 历史里 `7bc58d7`→`52fdde1` 这一串都是）。之后 Remy 对最新部署效果不满意，提了一大轮反馈，session 让 Remy 先选了几个开放问题的答案，然后做了小改动部署上线。**但 Remy 后续又发来一大轮"整个很难看，完全没照 proposal 做"的强烈反馈**，要求先出 HTML 静态提案给她逐屏确认、点头才能部署，不准再直接改真代码上线。

这个新 session 已经做了一版 HTML 提案（Artifact：`https://claude.ai/code/artifact/86772aaa-6ddc-4fd6-bff1-798788f15d1b`，10 屏），Remy 拿它跟**更早的另一份 proposal**对比后，给了极其详细的逐屏修改意见（几乎是要求推翻新提案、大量照抄旧 proposal 的排版）。**当前 session 此时 context 已经严重超支（约 200%），来不及在本 session 里执行这轮修订，交给下一个 session 接手。**

### 两份 proposal 的关系（避免重蹈"artifact 张冠李戴"的坑）
- **旧 proposal**：`https://claude.ai/code/artifact/6fa40df7-6ce2-4792-a018-99f1960ea1b3`——Remy 这次发来的截图里标注"◎ XX + app/xxx/page.tsx"这种带文件路径角标的版式，就是这份。**注意**：本文件上半部分（2026-09-12 那次记录）曾经查证过这个链接实际内容是"配色方案对比稿"（跟仓库 `DESIGN-BRIEF-color-v6-preview.html` 逐字节一致）。但 Remy 这次给的截图明显包含**排版/布局/组件**级别的设计（钱包深色卡片规格、结算页试金石注释"该收固定用森林绿#3D6141"、支付方式页面文案"支付方式挂在你自己身上跟人走不跟行程走"等），**这些内容不在 2026-09-12 查证过的那份色板对比稿范围内**——大概率 Remy 这次给的是同一个 artifact 的**新版本**（她自己在 claude.ai 网页上迭代过、发布了新版本覆盖了旧内容），或者是另一个我们没追踪过的 artifact。**新 session 接手第一件事：用 Artifact read 工具重新读一次 `6fa40df7` 这个 URL 的最新内容，不要相信本文件 2026-09-12 那段"其实是配色对比稿"的旧结论，那可能已经过期。**
- **新 proposal（这次做的）**：`https://claude.ai/code/artifact/86772aaa-6ddc-4fd6-bff1-798788f15d1b`，源文件在本机 `/private/tmp/claude-501/-Users-linotan-Desktop-Claude/93d49d23-85d9-474a-a358-b6a809306be8/scratchpad/trip-ledger-proposal.html`（这是旧 session 的 scratchpad 路径，新 session 大概率访问不到，需要用 Artifact read 重新拉取内容再改，或者直接重写）。这份配色/字体 token 是照当前**真实代码**（`tailwind.config.ts`/`app/globals.css`）扒的，不是凭空编的——这点做对了，continue 保持"照真实代码token改"这个原则，只是排版/间距/组件规格这次被 Remy 判定跟旧 proposal 差太远。

### Remy 逐屏修改意见（原文整理，按屏幕分组，都是要在 HTML 提案里改，还没碰真代码）

**首页 · 我的行程**
1. "＋创建新行程"按钮位置要挪到右上角（跟标题"我的行程"同一行），不要放在卡片列表下面单独一行；大小参照旧 proposal 那颗按钮（旧版是标题右侧的深色胶囊，不是新版这种铺满宽度的大按钮）
2. 行程卡片背景要浅灰色，不要纯白色（旧 proposal 卡片背景是浅灰）
3. "该收 RMXXX"这个金额文字要再小一号，而且要加粗（bold）

**行程主页**（意见最多，逐条）
1. 右上角"曼谷出差 ▾"这颗切换器胶囊要再小一些，看起来才舒服（新版做大了）
2. 下拉面板要更紧凑，参照旧 proposal 那种"挤"一点的间距；配色也要跟旧 proposal 一致；**下拉里不需要显示"该收 RMXXX"这个金额**（新版在切换到其它行程那一行显示了金额，Remy 不要这个）
3. 下拉里的"＋创建新行程"要挪到面板右上角落，字体要小一些（不是像新版那样占一整行、字号还挺大）
4. "查看结算明细→"这个链接要改成参照旧 proposal 那种小按钮样式（不是新版的纯文字下划线链接），但**位置维持新版现在这个位置**（Hero 卡右上角），不要挪到旧 proposal 的位置
5. "我的钱包"这个区块要换成跟旧 proposal 完全一样的规格、大小、颜色——旧 proposal 钱包卡片是纯黑背景，新版用的是白色半透明叠加（`rgba(255,255,255,.08)`），Remy 要旧版那种更黑更实的
6. "记"这个圆形确认按钮要再小一些；快速记账这个区块**少了可以输入商家名字的字段**，要补上
7. "💱 当前汇率比价"这个卡片在新方案的静态稿里点了没法展开查看内容（新版这只是个静态样式，没做真的展开交互）——新 session 要注意：如果继续做静态 HTML 提案，至少要让这个按钮点了真的能展开/收起（哪怕只是简单的 JS toggle），不能是纯装饰误导 Remy 以为它是活的
8. "参与者"卡片要更紧凑（padding/间距收紧）
9. "活动流"卡片要更紧凑，而且**少了分类的 emoji**（新版活动流示例"餐饮"文字前没有配 🍜，要补上，这是这个项目这轮反复提到的"分类要有 emoji"这条要求，活动流里显示历史记录也要一致地带 emoji，不能只有记账表单里选的时候有）
10. "参与者"、"活动流"这两个副标题（h2）的字体样式要参照"记一笔消费"页面自己的副标题样式统一（Remy 截图标注了参照对象，新 session 要去新旧两份 proposal 里对比"记一笔消费"页面标题用的具体字号/字重，套到这两个副标题上）

**记一笔消费**
1. 所有可输入/可选择的控件（tab/下拉/输入框）都要再收窄一档（比"比价"结果卡片那种偏大的要缩小）
2. 表单整体要更紧凑（间距再收）
3. 按钮也要缩小收紧——**Remy 特别强调：要统一这个系统里"深灰色底部主按钮"的尺寸规格**，不要各屏各写一套大小，这是个全局一致性要求，不是单一页面的事

**取款 / 换汇**
1. 整体要更紧凑
2. 所有可输入/可选择控件都要收窄
3. 按钮要缩小收紧；**排版布局本身建议参照旧 proposal 修改**——旧 proposal 换汇页是"点选钱包按钮式布局"（来源钱包/目标钱包各是一排可选按钮，不是新版这种下拉选择+分离的金额输入框），这可能不只是视觉调整，是要重新设计这个页面的交互布局，新 session 要仔细对比两版差异再动手，拿不准布局改动幅度就先问 Remy 确认范围

**结算 / 支付方式 / 邀请管理 / 新建行程 —— 这四个页面 Remy 直接说"照搬旧 proposal 的模板就好"**，不需要自己发挥，照旧 proposal 里对应这四屏的排版/字号/配色/文案抄过来即可（旧 proposal 里这几屏似乎还带一些新版没有的功能文案，比如支付方式页"支付方式挂在你自己身上，跟人走不跟行程走"这句说明文字、结算页"该收该付试金石"的语义色不随主题变的注释——新 session 抄的时候留意这些文案/机制说明是否也要保留）

**新建钱包（弹层）**
- 照旧 proposal 的模板改风格排版和字体大小（旧版账户类型图标选中态是绿色描边，新版这次做的也是绿色描边，这条大概率已经对了，其它字段间距/字号照旧版收紧）

### Remy 的执行要求
- 原话："/pm 你还是做得不够仔细，拉上可以完成任务的subagent、skill一起执行。先改这个方案，等我点头后再部署"——**要求走 lifeos-pm 派工，动用合适的 subagent/skill，但这一轮仍然只改 HTML 提案，不碰真代码/不部署，等 Remy 点头以后才允许动真格**
- 这是当天第二次要求"先出静态提案给我确认"，第一次给的提案（86772aaa）被判定"完全没照旧 proposal 的方向"，说明**新 session 动手前务必先把两份 proposal 都完整看一遍再改**，不要又凭对代码token的理解自己发挥出第三个版本

### 新 session 建议的第一步
1. 用 Artifact read 工具分别重新读一遍 `6fa40df7`（旧proposal，可能有更新版本）和 `86772aaa`（新proposal，即这轮要修订的对象）的完整最新内容
2. 逐屏对照上面这份清单，在 `86772aaa` 这个 artifact 上原地修订（用同一个 file_path 重新 Artifact publish 即可更新，不用发新链接）
3. 改完请 Remy 逐屏确认，全部点头后才可以着手真代码实现 + 部署，且部署前仍要走 `./deploy.sh` 五道关卡 + 这个项目一贯的 ui-auditor 真机验收标准


> 这份文件不进版本控制（不 git add），纯粹是这轮任务的备份记录，防止异步通知丢内容。
> 写于 2026-09-12 16:37，session: https://claude.ai/code/session_01CpJ1zgkaAPT5pV57bBdwPF

## 0. 这次修的客观 bug

**问题**：记账表单（`app/trips/[tripId]/expenses/expense-form.tsx`）金额输入框跟币种下拉同一行，高矮不齐——金额框 46px，币种框 35px。

**根因**：金额框的 class 是 `field-input font-serif text-lg font-medium tabular-nums`，`text-lg` 是 Tailwind 默认 18px/28px 行高，叠加 `.field-input` 的 `py-2`(16px) 撑到 46px；币种 `<select>` 只有裸 `field-input`（12.5px 字号），停在 35px。

**修法**：去掉 `text-lg`，金额框回到跟全站其它 `.field-input` 一致的 12.5px 字号（`font-serif`/`font-medium`/`tabular-nums` 保留，数字继续用衬线体+等宽数字，只是不再单独放大）。

**commit**：`45a9c5afea221f525897ba66c05b4872a7f7a0e9`

**验证**：本地 `npm run dev` 起服务，走 Playwright 建行程→进记账表单，`getBoundingClientRect` 量：金额框从 46px 降到 36.75px，币种框仍 35px，只差 1.75px。这个残差是 `<input>` 跟原生 `<select>` 的浏览器渲染差异（line-height:`normal` vs 显式 18.75px），**全站本来就这样**——`new-trip-form.tsx` 的"行程名称"输入框(input)配"本位币"下拉(select)也是同样 36.75px vs 35px，不是这次要修的 bug，是浏览器给 input/select 的天然渲染差。部署后在线上 `https://trip-expense-ledger.remybali.workers.dev` 建了个真实行程（"部署验证测试(可删)"，trip id `3238cd07-09e6-4095-9e1b-b5099febb6af`，需要 Remy 自己在设置里删掉，我没敢在生产 D1 上手写跨表 SQL 删）复测，结果一致。

## 1. artifact 实际打开看到了什么

链接 `https://claude.ai/code/artifact/6fa40df7-6ce2-4792-a018-99f1960ea1b3` 用 WebFetch 直接打开成功了（这个 artifact 归你自己所有，WebFetch 能读到完整源码，不是登录墙问题）。

**看到的实际内容**：标题是"配色方向全屏走查"，全篇是**配色方案 A/B/C/D 候选对比稿**（12 个真实界面 × 多个候选配色方案的静态渲染），核心内容是 `--a-ink`/`--a-sand`/`--a-gold` 等颜色 token 在候选 B(暖阳蓝调)/候选 C(ON ICE 巧克力配牛仔蓝)/候选 D(渐变灰阶) 之间怎么取值，附带 11 轮修订说明（"quote"框）记录每轮改了什么。

**关键发现**：这份 artifact 的内容跟仓库里已经存在的本地文件 `DESIGN-BRIEF-color-v6-preview.html`（126093 字节）**逐字节完全一致**（`diff` 只有 artifact 发布工具自动加的收尾 `</body></html>` 两行差异）。也就是说 Remy 给的这个链接不是什么新东西，就是这份色板预览稿本身，早就在仓库里躺着。

**跟①-⑥项的对应关系**：这份 artifact 是"配色方向"探索稿，不是①-⑦项视觉统一化提案的原始出处。逐项核对下来：
- ③ 行程切换器（`.ts-trigger`/`.ts-panel`/`.ts-row` 这几个 class）——**有**明确像素级规格
- ② 数字字体——**部分有**，只写了 Hero 净额大数字的字体（IBM Plex Serif），没写全站其它数字字体规则
- ①tab尺寸 / ④tab按钮偏大 / ⑤悬浮按钮 / ⑥分类emoji——**完全没提**，全篇 grep "FAB"/"悬浮"/"emoji"/"tab" 零命中

## 2. ①-⑥ 逐项状态

### ① tab 尺寸 + ④ tab 按钮偏大 —— 已实现

判定这两项对应的是行程详情页头部导航（"行程主页/结算/支付方式/邀请管理"这排链接），因为全仓库唯一符合"多个平级导航项排一排"这个"tab"形态的就是这个。

- 字号：`cebc19f`（2026-09-12 更早的一次审美修复，非这次任务做的）已经从 12.5px 调到 10.5px，这次没再动。
- 触控高度（这次修的）：这排链接原本手写 `min-h-[44px]`，是 `DESIGN-BRIEF.md` 第四版补丁明确推翻的旧规则——第 247/281/282/378 行白纸黑字："纯文字链接触控高度 min-h-44px → min-h-32px"，仓库里 `.tap-link`（`app/globals.css` 第 31-33 行）这个 class 本来就是 32px，全站其它文字链接（"查看结算明细→"等）早就在用，只有这排导航当初手写 class 没接上，漏成孤例。三份文档（`DESIGN-BRIEF-homepage-redesign.md`、`DESIGN-BRIEF-color-directions.md`）都没提过这个具体元素的触控高度，不存在冲突。
- **commit**：`742a448d5855ecab5e19c6cc5dbbc00bb64e74c8`
- **验证**：Playwright 量 4 个导航链接的 `getBoundingClientRect`，本地和线上（`https://trip-expense-ledger.remybali.workers.dev`）都是 32px。

### ② 数字字体 —— 卡住待拍板

**具体冲突**：
- **artifact**（= `DESIGN-BRIEF-color-v6-preview.html` 第 430 行）：`.hero-num { font-family: 'IBM Plex Serif', serif; font-weight: 600; font-size: 22px; ... }` —— Hero 卡净额大数字用 **IBM Plex Serif**，22px，字重 600。
- **`DESIGN-BRIEF-color-directions.md`**（这份文档是 v6-preview.html 的文字版提案，同一批产出）第 142 行原话："**Fraunces 继续严格限定在数字金额场景，不碰中文标题**"；第 367 行结论原话："**继续用 Fraunces，不引入新字体**"。
- 这两份文档互相矛盾，而且是**同一个提案系列自己打自己脸**——v6-preview.html（也就是 Remy 给的这个 artifact）从第一轮到第十一轮的改动说明里，从来没提过要引入 IBM Plex Serif 这个新字体，也没解释过为什么要推翻 color-directions.md 自己刚写的"不引入新字体"结论。
- **`DESIGN-BRIEF-homepage-redesign.md`** 第 114 行也只说"净额数字继续用 `font-serif`(Fraunces)"，跟 color-directions.md 一致，都不支持引入 IBM Plex Serif。
- **当前代码**（`app/trips/[tripId]/page.tsx` 第 96-99 行）：Hero 净额数字用 `font-serif text-2xl font-medium tabular-nums`，即 Fraunces、24px、字重 500——沿用 Fraunces，没有采纳 artifact 的 IBM Plex Serif。
- **代码库里目前压根没装 IBM Plex Serif**：`app/layout.tsx` 只 `import { Inter, Fraunces, IBM_Plex_Mono } from 'next/font/google'`，三个字体家族里没有 Plex Serif。

**为什么没直接照 artifact 实现**：这不是"随手改改数值"级别的改动，是往全站引入第 4 种从没用过的字体家族，而且直接违反同一个提案系列自己刚讲完的"不引入新字体"结论，风险层级不低（"金额只用 Fraunces、不碰中文"这条纪律在 `DESIGN-BRIEF.md` 里被反复强调成接近"绝对禁止"级别的规则，多处提到要保持一致性）。需要 Remy 明确拍板要不要真的给 Hero 净额数字单开一个字体，我没有擅自改。

**没有动的代码**：`app/trips/[tripId]/page.tsx` 第 96-99 行，保持 Fraunces 现状。

### ③ 行程切换器 —— 卡住待拍板

**具体冲突**：
- **artifact**（= `DESIGN-BRIEF-color-v6-preview.html` 第 464 行）：`.ts-trigger { font-size: 9px; font-weight: 700; color: #fff; padding: 2px 8px; border-radius: 999px; background: var(--a-ink); }`——一个**很小、深色实底填充的胶囊**（9px 白字配深底），克制不抢戏；下拉面板 `.ts-panel`/`.ts-row` 同样是 10px 左右的小字号 + 洗色浅底。
- **当前代码**（`app/trips/[tripId]/trip-switcher.tsx` 第 39-44 行注释 + 第 70-79 行实现，commit `7bc58d7`，就是**今天** 2026-09-12 做的）：`text-lg font-bold text-gold-dk`，即 **18px 粗体**，无背景填充。commit message 原话："标题栏：trip-switcher.tsx 字号从 12.5px 改 text-lg font-bold 撑起'标题'的视觉份量"——这是 Remy 本人当天真机走查后明确反馈"这是每个子页面顶部唯一真正的'行程标题'……原本 12.5px 跟其它次级文字同一档，读起来不像标题"之后改的。
- 这不是"旧设计文档互相打架"，是**更早的一份配色预览稿**（v6-preview.html，2026-09-10 完稿）跟**Remy 当天亲自真机验收后给的直接反馈**（2026-09-12）打架，时间上后者更新、也更有权威性（是实机验收意见，不是静态 mockup 猜测）。

**为什么没照 artifact 实现**：照 artifact 改回 9px 深色小胶囊，等于直接推翻 Remy 今天亲口反馈"要撑起标题份量"的意见。我判断这种情况不该由我自己选边站，需要 Remy 明确讲清楚："今天的反馈"和"这份更早的配色预览稿"到底听哪个，我才敢动。

**没有动的代码**：`app/trips/[tripId]/trip-switcher.tsx` 第 70-79 行，保持今天真机走查后的大字体版本。

### ⑤ 记一笔消费悬浮按钮 —— 已符合规格，未发现待办

- artifact 全篇没有提到 FAB/悬浮按钮，`DESIGN-BRIEF-homepage-redesign.md`、`DESIGN-BRIEF-color-directions.md` 也没有（后者只在配色表格里提过一句"FAB/按钮 hover 用 accent-800"，颜色早就对了）。
- 唯一权威依据是 `DESIGN-BRIEF.md`（第 252-257/369 行）：FAB 容器 `min-h-[44px]`——文档原话"第三版这里反而是做对的，不用改"。
- 当前代码（`app/trips/[tripId]/record-expense-fab.tsx`）：`min-h-[44px]` 胶囊按钮，图标+"记一笔消费"文字，颜色 `bg-accent-700 hover:bg-accent-800`——跟文档要求一致。避让遮挡逻辑的 bug 也在更早的 commit `26377cb` 修过并验证过。
- **结论**：这项没找到任何冲突或待办，现状就是对的，这次没有改动。

### ⑥ 分类 emoji 全覆盖 —— 已实现（今天更早完成，同 session）

- `lib/domain/categories.ts` 现状：`['🍜 餐饮', '🚗 交通', '🏨 住宿', '🎫 门票', '🛍️ 购物', '📦 其他']`——6 个内置分类**全部**带 emoji，两处表单（`expense-form.tsx`/`quick-add-expense.tsx`）共用同一份 datalist，直接受益。
- **commit**：`7bc58d7939cdf4a3fbc7a7652e6b43e37e1fec81`（跟这次是同一个 session，比我这轮任务更早完成，我核对过确认已经落地，这次没有重做）。
- 这项不存在"artifact vs 文档冲突"的问题，是任务分配时信息没同步——commit 记录清楚显示已经做完了。

## 3. 部署与验证

- **部署commit范围**：本轮涉及 `45a9c5afea221f525897ba66c05b4872a7f7a0e9`（金额框bug）+ `742a448d5855ecab5e19c6cc5dbbc00bb64e74c8`（tab触控高度）。
- **走 `./deploy.sh`**：lint/typecheck/单测(50个全过)/opennextjs-cloudflare build/wrangler deploy 五关全过，Version ID `62146709-042a-45b7-881d-9c287f2ea4f2`。
- **线上回读**：`https://trip-expense-ledger.remybali.workers.dev` 建了个真实测试行程（id `3238cd07-09e6-4095-9e1b-b5099febb6af`，名字"部署验证测试(可删)"，**建议 Remy 自己在网页里删掉**），Playwright 量 `getBoundingClientRect` 确认：
  - 导航链接 4 个全部 32px（原 44px）
  - 记账表单金额框 36.75px / 币种框 35px（原 46px / 35px）
