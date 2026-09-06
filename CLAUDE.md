# trip-expense-ledger 项目专属 CLAUDE.md

> 中文名「消费记录」。出差消费记录 App，记账 + 同行人代垫结清 + 汇率比对/最省钱支付方式推荐。
> 轻量邀请链接分享给同行人协作，但保护个人消费隐私（净额结算公开，逐笔明细默认私密）。

## 项目定位（别写歪）
- 不是泛用 AA 分账工具（Splitwise/Tricount/Settle Up 类），是**出差场景专属**结构化记账
- 差异化卖点，写代码/文案时时刻记住：
  1. 汇率比对 + 算这笔消费用哪张卡/哪种支付方式最省钱（市场空白，别弱化这个功能）
  2. 出差场景专属结构化记账
  3. 隐私自托管，数据不放别人服务器，Docker 一键自托管

## 技术栈
- Next.js（App Router）全栈单体 + TypeScript
- SQLite + Drizzle ORM + better-sqlite3
- Docker 单容器自托管，不依赖任何云托管 / Supabase / Cloudflare
- 单元测试：Vitest

## 数据模型核心表
- `trip`：一次出差行程
- `participant`：行程参与者（含未认领的占位名字）
- `session`：认领后签发的登录态（token 只存 hash，不存明文）
- `invite`：邀请链接（code → trip，认领后对该身份失效）
- `expense`：一笔消费，关键字段：
  - `entered_by_participant_id`：谁录入的，决定隐私归属，是私密查询的唯一合法过滤键
  - `payer_participant_id`：谁代垫/实付
  - `amount_base_currency`：录入时**固化**换算后的基准币种金额，不做延迟换算，防止历史汇率漂移改写旧账
- `expense_split`：这笔消费怎么分摊给谁
- `payment_method`：挂在 `participant` 上，用户预配置的支付方式（费率/汇率加点）
- `settlement_snapshot`：仅当行程被**显式标记「已结算」**时才写入的冻结快照，平时净额是实时算出来的，不落库
- `exchange_rate_cache`：汇率缓存（手动输入或拉取）

## 邀请链接机制（安全边界，改动前先想清楚）
1. 创建者预建同行人名字占位（此时还没有真实身份绑定）
2. 生成 `/invite/{code}`
3. 同行人打开链接，只看到「未认领」的名字列表（不能看到已认领的人是谁绑的）
4. 点选认领后生成 session token，写 httpOnly cookie，**DB 只存 hash**，不存明文 token
5. 认领后，这个链接对该身份**立即失效**（防止别人顶替已认领身份）
6. 创建者可以撤销 / 重置某个人的认领状态

这套机制的定位是**给互相信任的同行人提供低摩擦协作**，不是金融级身份鉴权。别指望它防蓄意攻击者，威胁模型详见 `SECURITY.md`。

## API 权限边界（硬性要求，Code Review 必查）
- 任何查询「消费明细」的函数，内部必须**硬编码** `WHERE entered_by_participant_id = <session 解出的 id>`
- **不接受任何客户端传参覆盖这个过滤条件**，前端传来的 participant id 只能用来查自己，不能用来越权查别人
- 无权限时返回 **404**，不返回 403（403 会泄露"这条记录存在但你没权限"，404 更安全）
- **结算接口是唯一允许跨参与者读取的查询**：
  - 输出必须走严格类型 DTO，显式字段映射（`{ participantId: x.id, netAmount: x.net }` 这种写法）
  - **禁止对象展开**（`{ ...expense }` 这类写法），防止意外把私密字段（比如某人具体买了什么）带出到跨参与者可见的结算响应里

## 核心算法（纯函数，测试覆盖率要求最高的两个模块）
### `lib/domain/settlement.ts`：净额结算
1. 先按参与者算净值：整数分（cents）运算，不用浮点数，避免精度误差累积
2. 用贪心「最大债权人配最大债务人」做最少转账笔数简化
   这是启发式算法，不是 NP-hard 精确解，**够用即可**，不要在这上面过度设计
3. 只有行程被显式标记「已结算」时才写 `settlement_snapshot`，平时净额永远实时算，不缓存

### `lib/domain/fx-recommendation.ts`：支付方式比价
- 纯函数：输入金额 + 币种 + 用户配置的费率规则，输出按等值成本排序的支付方式列表
- 汇率拉取失败**不能阻塞记账**，走手动输入兜底，让用户先把账记上，比价可以后补

## 目录结构
```
app/                    # Next.js App Router：页面 + app/api/**/route.ts
lib/db/                 # Drizzle schema + migrations
lib/auth/               # session + invite 认领逻辑
lib/domain/             # 核心纯函数：settlement.ts / fx-recommendation.ts
docker/                 # Dockerfile + 相关配置
```

## Docker 化
- 单容器，SQLite 文件 + 收据图片都挂载在 `./data` 卷下
- `docker compose up -d` 一条命令跑起，不需要外部数据库服务
- 不依赖任何云托管平台

## 测试哲学
- `settlement.ts` 和 `fx-recommendation.ts` 是纯函数，**必须有单元测试**，是 v0.1 单测覆盖率要求最高的两个模块，涉及钱的计算逻辑，没测试不能合并
- API 权限边界（参与者 A 看不到 B 的明细）**必须有自动化测试覆盖**，不能只靠代码审查：写一个测试，A 登录后请求 B 的消费明细，断言返回 404
- 一般 UI 组件测试覆盖率不做硬性要求，但涉及金额展示/换算的组件要测

## CI / 提交前检查
- `.github/workflows/ci.yml` 跑：lint → tsc（类型检查）→ vitest（重点覆盖 settlement.ts / fx-recommendation.ts）→ next build
- `.github/dependabot.yml` 覆盖 npm + github-actions 两个 ecosystem，weekly
- **首次 push 前手动跑一次 gitleaks 本地自查**（`gitleaks detect` 或类似），公开仓库的 git 历史是永久的，key 泄露了删代码也没用

## v0.1 范围（这一版只做这些，别自己加料）
- [ ] 新建行程 + 记消费（金额/币种/分类/收据图片）
- [ ] 标记代垫人，行程结束自动结算「谁欠谁多少」（最少转账笔数简化算法）
- [ ] 多币种录入 + 手动/拉取当日汇率，算「这笔用哪张卡/现金最划算」
- [ ] 轻量邀请链接分享行程给同行人协作记账（无账号密码，认领机制）
- [ ] 权限模型：净额结算公开，逐笔明细默认私密

**明确排到 v0.1 之后（Roadmap，现在不做）**：
- 银行卡实时汇率 API 自动对接
- 正式账号系统（邮箱 / OAuth 登录）
- 推送通知
- 多语言 i18n

## 贡献指南
- 提 PR 前先跑 `lint` + `tsc` + `vitest`，CI 红了不合并
- 涉及 `lib/domain/` 下的算法改动，必须带对应单测更新
- 涉及权限边界的改动（谁能查到谁的数据），必须带对应的越权测试
- 讨论架构性决定（数据模型改动、API 形状改动）先开 issue 对齐，不要直接开大 PR
