import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb, type Db } from '@/lib/db/client';
import { exchangeRecords, wallets } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';

interface Context {
  params: { tripId: string; exchangeRecordId: string };
}

/** 私有：跟 wallet/expense 一样硬编码 participant_id = 自己，别人的一律当不存在。 */
async function loadOwn(db: Db, id: string, tripId: string, participantId: string) {
  return db.query.exchangeRecords.findFirst({
    where: and(
      eq(exchangeRecords.id, id),
      eq(exchangeRecords.tripId, tripId),
      eq(exchangeRecords.participantId, participantId)
    ),
  });
}

/**
 * 删换汇记录要把它对钱包余额造成的影响原样撤回——POST（见 ../route.ts）怎么
 * 加/减，这里就反过来减/加回去：toWallet 扣掉 toAmount，fromWallet（如果有）
 * 补回 fromAmount。
 *
 * 这个反向操作等于"撤销这笔记录的净影响"，而不是"重算整条钱包历史"，是因为
 * 这个 app 的 wallet.currentBalance 从来就不是一份按时间顺序 replay 出来的
 * 账本，是一个被各处操作（这里的换汇 POST / 记一笔消费扣款 / 支付方式页
 * "设置当前余额"手动覆盖）直接累加或覆写的可变字段——除了"设置当前余额"是
 * 绝对覆写，其它每一处操作都只对"当下这个数"做一次相对 +/-，互相之间不引用
 * 对方，也不参照"这笔发生前后余额应该是多少"这种中间快照。在这种架构下，
 * 删掉一笔相对增减操作、把它的净影响原样减掉，数学上就等价于"这笔从来没
 * 发生过"，不需要也没办法去"级联重算"其它交易——那些交易压根没依赖过这笔
 * 换汇留下的中间值。
 *
 * fix(2026-09-24 第五十轮，"设置当前余额"覆盖式 bug 修复)：上面这段"唯一没
 * 打算这轮解决的边界"已经解决——这次把"设置当前余额"之后的钱包切换成
 * lib/domain/wallet-balance.ts 的"锚点+推导"模式（`balanceUpdatedAt` 非空
 * 就代表已切换），这类钱包不再需要下面这段"反向抵消"的写入：删掉这条换汇
 * 记录之后，它本来就不会再被推导公式的 SQL 捞到（行已经不存在了），下次读
 * 余额自动是对的，不需要额外写一次 UPDATE 去抵消。只有还没设置过"当前余额"
 * 的钱包（旧的可变累加字段模式）才继续走下面这条反向抵消的写入路径，那部分
 * 行为跟这次改动之前完全一致，"编辑/删除消费也从不回溯余额"这条旧模式下的
 * 既有缺口，这次也一并保留（如实记录在 PENDING-DECISIONS，不是没考虑到）。
 */
export const DELETE = withSession<Context>(async (_request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const existing = await loadOwn(db, params.exchangeRecordId, params.tripId, identity.participantId);
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const toWallet = await db.query.wallets.findFirst({ where: eq(wallets.id, existing.toWalletId) });
  const fromWallet =
    existing.fromWalletId && existing.fromAmount !== null
      ? await db.query.wallets.findFirst({ where: eq(wallets.id, existing.fromWalletId) })
      : null;

  // 显式 unknown[]：delete 和 update 是 drizzle 里两种不同的语句类型，数组字面量
  // 会按第一个元素窄推断类型、后面 push 不同类型的语句会报类型不兼容，跟下面
  // db.batch() 调用点统一做一次断言的理由一样（remote binding 场景下这几类语句
  // 混批本来就是 drizzle D1 官方推荐用法，只是 TS 元组类型推不出可变长度混合数组）。
  const statements: unknown[] = [db.delete(exchangeRecords).where(eq(exchangeRecords.id, params.exchangeRecordId))];

  if (toWallet && toWallet.balanceUpdatedAt === null) {
    statements.push(
      db
        .update(wallets)
        .set({ currentBalance: toWallet.currentBalance - existing.toAmount })
        .where(eq(wallets.id, toWallet.id))
    );
  }

  if (fromWallet && existing.fromAmount !== null && fromWallet.balanceUpdatedAt === null) {
    statements.push(
      db
        .update(wallets)
        .set({ currentBalance: fromWallet.currentBalance + existing.fromAmount })
        .where(eq(wallets.id, fromWallet.id))
    );
  }

  // 同一批 D1 batch()：删记录 + 最多两笔钱包余额回滚，跟 POST 那边"一次原子写入"
  // 的理由一样（remote binding 不支持交互式事务），数组长度视 from/to 钱包是否
  // 还存在而变化，跟 expenses PATCH 里同款写法一样做运行时断言。
  await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);

  return new NextResponse(null, { status: 204 });
});
