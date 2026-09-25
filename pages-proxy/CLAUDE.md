# kongsi-trip 转发层

这是 `trip-expense-ledger` 这个旅行记账 app 的一个独立 Cloudflare Pages 项目，
域名 `kongsi-trip.pages.dev`（2026-09-25 建，Remy 亲选的名字），只做一件事：
把收到的请求原封不动转给同仓库里的 Worker 本体 `trip-expense-ledger`。

## 为什么要这一层

马来西亚网络挡 `*.workers.dev` 域名，Remy 手机不开 VPN 打开旧网址
`trip-expense-ledger.remybali.workers.dev` 会白屏；`*.pages.dev` 域名不受影响。
另外她不想网址里带 `remybali` 字样。所以加了这个转发层当主要入口，旧网址保留
不动当备用入口，两个网址打开的是同一份代码、同一份 D1 数据库
`trip-expense-ledger-db`，没有新建数据库、没有复制数据。

## 架构

`functions/[[path]].js` 是唯一的真实代码，靠 `wrangler.toml` 里的
`[[services]]` service binding（binding 名 `ORIGIN`，指向 Worker
`trip-expense-ledger`）把每个请求原样传给
`context.env.ORIGIN.fetch(context.request)`，不改 URL、不改 header、不改
body。`public/_routes.json` 强制所有路径（包括 `/`）都走这个 Function，
`public/` 目录下就算以后不小心放了同名静态文件也不会抢先命中、绕过转发。

**这个目录不应该长出业务逻辑。** 记账/结算/汇率/登录这些功能全部在仓库根目录
的 `app/`、`lib/` 里，改那些代码只需要跑根目录的 `./deploy.sh`，不需要碰这个
目录。只有转发逻辑本身要改（比如以后要加请求头改写、按路径分流到不同
Worker）才需要动 `pages-proxy/`。

## 为什么 request.url / cookie / 登录链接不用额外处理就能自动跟着正确的网址走

因为转发函数把 `context.request` 原样传给 service binding 的 fetch，不重新
`new Request(...)`——下游 Next.js/OpenNext 拿到的 `request.url`、
`headers().get('host')`，天然就是浏览器实际打开的域名（`kongsi-trip.pages.dev`
或 `trip-expense-ledger.remybali.workers.dev`，看用户走哪个入口），不是转发层
自己的域名。身份直连链接（`/api/account/provision` 里 `new URL(...,
request.url)`）、PIN 找回后的跳转（`/id/[token]/route.ts`）、账号页读
`headers().get('host')` 拼 `identityUrl`（`app/account/page.tsx`）这几处都是
靠这个"原样透传"自动生成对的域名，不需要转发层自己关心业务语义、也不用给
每个入口单独写 host 白名单。Cookie 同理：`lib/http/session-cookie.ts` 里
`Set-Cookie` 从来没设过 `Domain` 属性，浏览器默认按实际响应的域名种，两个
网址的登录状态天然不共享——这是预期行为，不是 bug，第一次打开
`kongsi-trip.pages.dev` 需要重新走一次登录/身份直连流程。

这个 app 没有 service worker、`app/manifest.ts` 的 `start_url` 是相对路径
`/`，所以换域名不存在 PWA 缓存卡旧域名的风险。

## 部署

一律走 `./deploy.sh`（这个目录自己的，不是仓库根目录那份），不能裸
`wrangler pages deploy`。关卡：① git 工作树干净（scoped 到这个目录）+ HEAD
已推 origin/main ② 语法检查 ③ 转发冒烟测试（`npm test`，验证转发函数的逻辑
没被改坏，mutation 验证过）④ `wrangler pages deploy` ⑤ 回读本次部署的直连
URL 打 `/api/health`（这个请求会一路转发到 Worker 本体真的查一次 D1）。

## 绝对不能碰的东西

- 不能改 `wrangler.jsonc`（仓库根目录，Worker 本体的配置）的 `name` 字段或
  任何路由/域名设置
- 不能碰账号的 workers.dev 子域名 `remybali` 本身——`remy-api.remybali.workers.dev`
  这个共用后台 Worker 挂在它下面，schedule/SUI 等好几个系统靠它，改了会全断
- 不建议给这个目录单独接 D1/R2 binding——它不需要直接碰数据，所有数据访问都
  应该经由转发到 Worker 本体完成
