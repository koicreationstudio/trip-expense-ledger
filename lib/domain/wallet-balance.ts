import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { exchangeRecords, expenses, wallets } from '../db/schema';

type WalletRow = typeof wallets.$inferSelect;

/**
 * 钱包"当前余额"怎么算，取决于这个钱包有没有被显式「设置当前余额」过——
 * 这是 2026-09-24 第五十轮修复"设置当前余额覆盖式 bug"（HKD 钱包 8120@09-15
 * 覆盖掉历史回溯 -246）时定下的架构：不再让"设置当前余额"这个 PATCH 简单
 * 绝对覆写 currentBalance，也不再指望「记账自动扣/换汇增减/编辑/删除消费」
 * 这几处各自小心翼翼维护同一个可变累加字段互不踩脚——改成"读的时候现算"。
 *
 * ## 两种模式
 *
 * - **从没设置过（`balanceUpdatedAt` 为 null）**：这个钱包还停留在"旧的可变
 *   累加字段"模式——`currentBalance` 是建钱包时的历史回溯（wallets/route.ts
 *   POST）+ 记一笔消费自动扣（expenses/route.ts POST）+ 换汇增减
 *   （exchange-records/route.ts POST/DELETE）三条路径直接累加/覆写出来的值，
 *   这几条路径的写入逻辑完全没有改动，这个函数原样把 `wallet.currentBalance`
 *   返回，行为跟这次改动之前完全一致。**这个模式下"编辑/删除消费不会回滚
 *   钱包余额"这个从 v1 就有的既有缺口原样保留，这次没有扩大范围去补**（详见
 *   PENDING-DECISIONS 这轮记录，是一个如实标注、没有处理的残留缺口，不是
 *   这次改动引入的新问题）。
 *
 * - **设置过至少一次（`balanceUpdatedAt` 非空）**：这个钱包切换成"锚点 + 推导"
 *   模式——`currentBalance` 存的是"记录日期当天那一刻的余额"这个锚点原始值
 *   （PATCH 写入时不做任何计算，就是用户输入的原始数字），真正显示的余额是
 *   每次读的时候现算：
 *
 *     锚点值 − Σ(记录日期当天及以后、匹配这个钱包的消费金额)
 *            + Σ(记录日期当天及以后、这个钱包收到的换汇金额)
 *            − Σ(记录日期当天及以后、这个钱包转出的换汇金额)
 *
 *   "匹配这个钱包"跟 expenses/route.ts POST 现有的自动扣款判断口径完全一致：
 *   `enteredByParticipantId = 钱包主人` + `paymentMethodId = 钱包绑定的支付
 *   方式` + `currency = 钱包币种`。"记录日期当天及以后"用 `expenseDate`/
 *   `exchangeDate`（消费/换汇的真实日期字段，不是 `createdAt` 这个系统写入
 *   时间）跟 `balanceUpdatedAt` 比较，边界是 `>=`（当天算在"以后"这一段里），
 *   这是 Remy 本轮明确拍板的语义："记录日期 = 这一天时余额是 X，这一天当天
 *   及以后的消费都要扣"。
 *
 *   一旦进了这个模式，新增/编辑金额/编辑日期跨过锚点/编辑支付方式/删除消费，
 *   全部不需要在对应的 API 路由里额外写"回滚/重算"代码——这几个动作发生后，
 *   下次读这个钱包余额时，上面这条 SQL 会现查现算出最新结果，不需要维护一个
 *   "这笔消费有没有被算进余额里"的隐藏状态位（这正是旧模式下"编辑/删除不会
 *   回滚"这个缺口的根源：旧模式没有任何字段记录"这笔消费算过没有"，因为它
 *   从设计上就是一次性在写入那一刻做加减，不是可重算的）。
 */
export async function computeWalletDisplayBalance(db: Db, wallet: WalletRow): Promise<number> {
  if (!wallet.balanceUpdatedAt) return wallet.currentBalance;

  const anchor = wallet.balanceUpdatedAt;

  let expenseSum = 0;
  if (wallet.paymentMethodId) {
    const rows = await db
      .select({ total: sql<number>`coalesce(sum(${expenses.amount}), 0)` })
      .from(expenses)
      .where(
        and(
          eq(expenses.tripId, wallet.tripId),
          eq(expenses.enteredByParticipantId, wallet.participantId),
          eq(expenses.paymentMethodId, wallet.paymentMethodId),
          eq(expenses.currency, wallet.currency),
          gte(expenses.expenseDate, anchor)
        )
      );
    expenseSum = Number(rows[0]?.total ?? 0);
  }

  const [toRows, fromRows] = await Promise.all([
    db
      .select({ total: sql<number>`coalesce(sum(${exchangeRecords.toAmount}), 0)` })
      .from(exchangeRecords)
      .where(and(eq(exchangeRecords.toWalletId, wallet.id), gte(exchangeRecords.exchangeDate, anchor))),
    db
      .select({ total: sql<number>`coalesce(sum(${exchangeRecords.fromAmount}), 0)` })
      .from(exchangeRecords)
      .where(and(eq(exchangeRecords.fromWalletId, wallet.id), gte(exchangeRecords.exchangeDate, anchor))),
  ]);

  const exchangeNet = Number(toRows[0]?.total ?? 0) - Number(fromRows[0]?.total ?? 0);

  return wallet.currentBalance - expenseSum + exchangeNet;
}

/**
 * 批量版本：行程主页/钱包列表一次要显示同一个人的所有钱包，逐个 await 会有
 * N 份各自独立的小查询（每个已锚定的钱包最多 3 条 SQL），但这些钱包各自数据
 * 量很小（一趟行程的消费/换汇记录顶多几十上百条），并发 Promise.all 掉就够，
 * 不需要为了省这几条 SQL 去写一个更复杂的批量聚合查询。
 */
export async function computeWalletDisplayBalances(
  db: Db,
  walletRows: WalletRow[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  await Promise.all(
    walletRows.map(async (w) => {
      result.set(w.id, await computeWalletDisplayBalance(db, w));
    })
  );
  return result;
}

/** 把钱包行的 `currentBalance` 换成推导出来的显示值，方便直接喂给 toWalletDto。 */
export async function withDisplayBalance<T extends WalletRow>(
  db: Db,
  wallet: T
): Promise<T & { currentBalance: number }> {
  return { ...wallet, currentBalance: await computeWalletDisplayBalance(db, wallet) };
}
