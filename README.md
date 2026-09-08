# 消费记录 (trip-expense-ledger)

出差消费记录 App，记账 + 同行人代垫结清 + 汇率比对/最省钱支付方式推荐。
支持轻量邀请链接分享给同行人协作，同时保护个人消费隐私。

## 这是什么

一个专为**出差场景**设计的记账工具，不是泛用的 AA 分账工具。跟同行人一起出差时，谁代垫了什么、最后该怎么转账才最省事、这笔钱用哪张卡付最划算，这个项目试图把这几件事一起解决。

## 为什么用这个（而不是 Splitwise / Tricount / Settle Up）

- **汇率比对 + 最省钱支付方式推荐**：录入一笔多币种消费后，根据你自己配置的各支付方式手续费率和汇率加点，算出这笔钱用哪张卡 / 哪种支付方式最划算。这个功能目前市面上的分账工具（Splitwise、Tricount、Settle Up）都没有。
- **出差场景专属结构化记账**：不是泛用 AA 分账，围绕「行程」「代垫」「多币种」这些出差记账的实际痛点设计。
- **私有部署**：数据不放在第三方分账 SaaS 里，部署在你自己的 Cloudflare 账号下。

## 怎么装

部署在 Cloudflare Workers（`@opennextjs/cloudflare` + D1 + R2），不是 Docker 自托管。

```bash
git clone https://github.com/<TODO: 你的 GitHub 用户名>/trip-expense-ledger.git
cd trip-expense-ledger
npm install

npx wrangler login
npx wrangler d1 create trip-expense-ledger-db          # 把返回的 database_id 填进 wrangler.jsonc
npx wrangler r2 bucket create trip-expense-ledger-receipts
npm run db:migrate:remote

./deploy.sh
```

本地开发：`npm run dev`（`next.config.mjs` 里的 `initOpenNextCloudflareForDev()` 会自动接到本地 miniflare 模拟的 D1/R2，不用另外配置）。

<!-- TODO(Remy): 确认 SESSION_SECRET 等 secret 的 `wrangler secret put` 步骤要不要写进这里 -->

## 怎么用

<!-- TODO(Remy): v0.1 功能实装后，补充实际使用截图/流程说明。别在这里写还没做出来的功能。 -->

大致流程会是：
1. 注册/登录后新建行程
2. 记录消费（金额、币种、分类、收据图片可选）
3. 标记谁代垫了这笔钱
4. 生成邀请链接分享给同行人，同行人认领自己的身份后各自记账
5. 行程结束时看结算结果，谁该转给谁多少钱（自动算最少转账笔数）

## v0.1 范围

**这一版会做：**
- 新建行程 + 记消费（金额/币种/分类/收据图片）
- 标记代垫人，行程结束自动结算「谁欠谁多少」（最少转账笔数简化算法）
- 多币种录入 + 手动/拉取当日汇率，算「这笔用哪张卡/现金最划算」（基于你自己预配置的支付方式手续费率 + 汇率加点）
- 轻量邀请链接分享行程给同行人协作记账（同行人认领无需账号密码，创建行程的人需要账号）
- 权限模型：净额结算对全部参与者公开；每人自己录入的消费明细（金额/项目/收据）默认私密，仅本人可见
- 账号系统（仅创建者需要）+ 首页我的行程列表 + 顶部导航

**明确不在 v0.1（Roadmap，之后再看要不要做）：**
- 银行卡实时汇率 API 自动对接
- 推送通知
- 多语言 i18n

## 技术栈

- Next.js（App Router）+ TypeScript，全栈单体
- Cloudflare D1（SQLite 语义）+ Drizzle ORM + Cloudflare R2（收据图片）
- 部署：`@opennextjs/cloudflare` 打包成 Cloudflare Worker

## 隐私 & 安全模型

邀请链接机制是为了给互相信任的同行人提供低摩擦协作方式，**不是金融级身份鉴权**。详见 [SECURITY.md](./SECURITY.md)。

## 贡献

欢迎 PR。动手前建议先看一眼 [CLAUDE.md](./CLAUDE.md) 了解架构约定和测试要求。

<!-- TODO(Remy): 确认是否需要单独的 CONTRIBUTING.md / issue 模板 / PR 模板，v0.1 先不加，有人开始贡献了再补 -->

## License

MIT，见 [LICENSE](./LICENSE)。
