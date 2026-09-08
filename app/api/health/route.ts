import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';

/**
 * Docker HEALTHCHECK 用：不只是「进程还活着」，顺手跑一个最轻量的 DB 查询，
 * 数据库文件损坏/被锁住这类问题能在这里就被发现，比单纯打首页更有意义。
 *
 * 必须强制 dynamic：这个 handler 不读 cookies/headers，Next.js 会默认把它当
 * 静态路由在 build 阶段预渲染一次并缓存结果——那样每次 HEALTHCHECK 打到的都是
 * build 时那一次性查询的结果，跟运行时的真实 DB 状态完全无关，健康检查形同虚设。
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = await getDb();
    await db.run(sql`SELECT 1`);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
