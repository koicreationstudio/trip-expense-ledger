import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb, type Db } from '@/lib/db/client';
import { exchangeRecords, paymentMethods, wallets, walletBalanceHistory } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { toWalletDto } from '@/lib/http/dto';
import { parseJsonBody } from '@/lib/http/validate';
import { updateWalletSchema } from '@/lib/validation/schemas';
import { paymentMethodOwnerFilter } from '@/lib/domain/payment-method-scope';
import { computeWalletDisplayBalance, withDisplayBalance } from '@/lib/domain/wallet-balance';

interface Context {
  params: { tripId: string; walletId: string };
}

async function loadOwn(db: Db, id: string, tripId: string, participantId: string) {
  return db.query.wallets.findFirst({
    where: and(eq(wallets.id, id), eq(wallets.tripId, tripId), eq(wallets.participantId, participantId)),
  });
}

export const PATCH = withSession<Context>(async (request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const existing = await loadOwn(db, params.walletId, params.tripId, identity.participantId);
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const parsed = await parseJsonBody(request, updateWalletSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  if (body.paymentMethodId) {
    const owns = await db.query.paymentMethods.findFirst({
      where: and(eq(paymentMethods.id, body.paymentMethodId), paymentMethodOwnerFilter(identity)),
    });
    if (!owns) return NextResponse.json({ error: 'invalid_payment_method' }, { status: 400 });
  }

  // fix(2026-09-24 第五十轮，"设置当前余额"覆盖式 bug 修复)：HKD 钱包 8120@09-15
  // 覆盖掉历史回溯 -246 这个真实事故，根因是这里直接绝对覆写 currentBalance，完全
  // 不管记录日期当天及以后系统里已经存在哪些相关消费/换汇。这次改成"锚点 + 推导"
  // 架构（见 lib/domain/wallet-balance.ts 顶部大段注释，这是这次评估过"全推导式 vs
  // 只修 PATCH 这一点"两个方案后选定的架构）：这里写入的 `currentBalance` 不再是
  // "最终显示值"，是"记录日期当天那一刻的锚点原始值"——用户在这个面板里输入的数字
  // 原样存进去，不在写入这一刻做任何减法。真正显示给用户看的余额，改成每次读的时候
  // 用 computeWalletDisplayBalance 现查现算（会自动把记录日期当天及以后、系统里
  // 已经存在的相关消费/换汇一并扣掉/加上）——这一步不需要写在这里，交给下面
  // `withDisplayBalance` 在组装响应的时候做，也交给 GET /wallets 等其它读取点各自
  // 调用同一个函数，不是只有这个 PATCH 响应显示得对，别的地方还是老的数字。
  //
  // fix(2026-09-26，防覆盖确认流程 + 历史记录)：这次请求真的带了 `currentBalance`
  // （= 一次"设置当前余额"动作，不是单纯改名字/绑支付方式）时，`updateWalletSchema`
  // 现在强制要求同时带 `balanceUpdatedAt`（见该 schema 注释），不会再走到"没传日期
  // 就默认成今天"这条路——前端表单已经改成"生效日期必须主动选，不预填"，这里的
  // 校验是最后一道防线，不是只靠前端。写入新锚点的同一次请求里，追加一条
  // `wallet_balance_history`：`displayBalanceBefore`/`displayBalanceAfter` 用
  // 跟别处完全相同的 `computeWalletDisplayBalance` 分别算"改之前"（这次 UPDATE
  // 之前的 `existing`）和"改之后"（UPDATE 完重新查出来的 `updated`），不是另外
  // 发明一套算法。`prevAmount`/`prevEffectiveDate` 在这个钱包"改前从没设置过锚点"
  // （`existing.balanceUpdatedAt` 是 null）时允许为 null，代表"改前从未设置"，
  // 这条历史第一条照样要写，不能因为没有锚点就跳过。
  const isSettingBalance = body.currentBalance !== undefined;
  const displayBalanceBefore = isSettingBalance ? await computeWalletDisplayBalance(db, existing) : null;
  const prevAmount = existing.balanceUpdatedAt ? existing.currentBalance : null;
  const prevEffectiveDate = existing.balanceUpdatedAt;

  await db
    .update(wallets)
    .set({
      label: body.label ?? existing.label,
      emoji: body.emoji ?? existing.emoji,
      paymentMethodId: body.paymentMethodId === undefined ? existing.paymentMethodId : body.paymentMethodId,
      currentBalance: body.currentBalance ?? existing.currentBalance,
      // 只有这次请求真的带了 currentBalance（= 这是一次「设置当前余额」动作）才更新
      // balanceUpdatedAt；单纯改名字/绑支付方式不该悄悄刷新这个时间戳。这个字段现在
      // 身兼两职：①「记录日期」这个用户可见语义 ②这个钱包是否已经从"旧的可变累加
      // 字段"模式切换进"锚点+推导"模式的开关——非 null 就代表已经切换，往后这个钱包
      // 的显示余额一律走推导公式，不再吃 expenses/exchange-records 那几个路由里
      // 任何直接写 currentBalance 的增量更新（那几处已经改成先判断这个字段再决定
      // 要不要写，见对应文件注释）。body.balanceUpdatedAt 现在跟 currentBalance
      // 强制同进同出（见上面 schema 注释），isSettingBalance 为真时一定非空。
      balanceUpdatedAt: isSettingBalance ? new Date(body.balanceUpdatedAt!) : existing.balanceUpdatedAt,
    })
    .where(eq(wallets.id, params.walletId));

  const updated = await db.query.wallets.findFirst({ where: eq(wallets.id, params.walletId) });

  if (isSettingBalance) {
    const displayBalanceAfter = await computeWalletDisplayBalance(db, updated!);
    await db.insert(walletBalanceHistory).values({
      walletId: params.walletId,
      amount: body.currentBalance!,
      effectiveDate: new Date(body.balanceUpdatedAt!),
      changedByParticipantId: identity.participantId,
      prevAmount,
      prevEffectiveDate,
      displayBalanceBefore: displayBalanceBefore!,
      displayBalanceAfter,
    });
  }

  return NextResponse.json({ wallet: toWalletDto(await withDisplayBalance(db, updated!)) });
});

/**
 * 删钱包前先查有没有关联的换汇记录——有的话直接删会留下指向不存在钱包的
 * from/to 引用（schema 里 from_wallet_id 是 set null、to_wallet_id 是 cascade，
 * 硬删不会报错，但会悄悄抹掉一笔换汇记录的历史，这里选择更安全的做法：
 * 有关联记录就拒绝删除，跟项目里「删除有关联数据」的其它地方保持一样的谨慎程度）。
 */
export const DELETE = withSession<Context>(async (_request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const existing = await loadOwn(db, params.walletId, params.tripId, identity.participantId);
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const linkedRecord = await db.query.exchangeRecords.findFirst({
    where: and(
      eq(exchangeRecords.participantId, identity.participantId),
      eq(exchangeRecords.toWalletId, params.walletId)
    ),
  });
  const linkedAsSource = await db.query.exchangeRecords.findFirst({
    where: and(
      eq(exchangeRecords.participantId, identity.participantId),
      eq(exchangeRecords.fromWalletId, params.walletId)
    ),
  });
  if (linkedRecord || linkedAsSource) {
    return NextResponse.json({ error: 'wallet_has_exchange_records' }, { status: 409 });
  }

  await db.delete(wallets).where(eq(wallets.id, params.walletId));
  return new NextResponse(null, { status: 204 });
});
