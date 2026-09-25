// kongsi-trip.pages.dev 转发层 —— 唯一职责：把收到的请求原封不动转给现有
// Worker `trip-expense-ledger`（同一份 D1 `trip-expense-ledger-db`，不建新库、
// 不复制数据）。这个文件不应该长出任何业务逻辑：不改 URL、不改 header、不改
// body、不读/写任何数据。会长逻辑的地方是 trip-expense-ledger 本体（app/ 目录），
// 不是这里。
//
// 为什么要这一层：马来西亚网络挡 *.workers.dev 域名，Remy 手机不开 VPN 打开
// 现网址会白屏；pages.dev 域名不受影响。旧网址
// trip-expense-ledger.remybali.workers.dev 保留不动当备用入口，这层只是加一个
// 新的入口，不动现有 Worker 的路由/域名设置。
//
// `context.request` 原样传给 service binding 的 fetch —— 不新建 Request 对象、
// 不重写 url/headers/body，这样下游 Next.js/OpenNext 拿到的 request.url、
// headers().get('host') 天然就是用户实际打开的 kongsi-trip.pages.dev（不是
// 转发层自己的域名，也不是被转发方 Worker 的名字），身份直连链接
// (/api/account/provision)、PIN 找回后的跳转 (/id/[token])、账号页读 host 拼
// identityUrl 这几处都靠这个"原样透传"自动拿到正确的域名，不需要转发层自己
// 关心业务语义。
export async function onRequest(context) {
  return context.env.ORIGIN.fetch(context.request);
}
