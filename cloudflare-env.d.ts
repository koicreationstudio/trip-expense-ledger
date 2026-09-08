// @opennextjs/cloudflare 声明了全局 CloudflareEnv 接口，这里用声明合并补上
// 这个项目自己的 bindings（wrangler.jsonc 里配的 D1 + R2）。
declare global {
  interface CloudflareEnv {
    DB: D1Database;
    RECEIPTS: R2Bucket;
  }
}

export {};
