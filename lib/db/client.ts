import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import * as schema from './schema';

export type Db = DrizzleD1Database<typeof schema>;

type D1Provider = () => Promise<D1Database>;

let testD1Provider: D1Provider | null = null;

/**
 * 测试专用注入点：vitest 用这个把 getDb() 指去本地 miniflare 模拟的 D1，不走
 * 真实 Cloudflare context。特意不在这个文件里直接 import('wrangler')——即使是
 * 动态 import，Next 的 webpack 打生产包时还是会把它当成这个文件的依赖去分析，
 * wrangler 整个 CLI（含 esbuild/youch 等调试工具）会被一起打进 Worker 产物，
 * 直接把生产构建炸掉。真正的 wrangler 依赖收在 lib/db/test-client.ts，那个
 * 文件只被 *.test.ts 引用，Next 构建的入口图（route.ts/page.tsx）永远不会走到
 * 那个文件，wrangler 也就永远不会被生产构建看见。
 */
export function __setTestD1Provider(provider: D1Provider | null): void {
  testD1Provider = provider;
}

/**
 * D1 binding 只能在 request 时通过 Cloudflare context 拿到，Workers 里没有
 * 模块级单例这种东西——每次调用都建一个新的 drizzle 包装，本身很轻量（不是
 * 真的开一条连接），不会有性能顾虑。
 */
export async function getDb(): Promise<Db> {
  if (testD1Provider) {
    return drizzle(await testD1Provider(), { schema });
  }
  const { env } = await getCloudflareContext({ async: true });
  return drizzle(env.DB, { schema });
}
