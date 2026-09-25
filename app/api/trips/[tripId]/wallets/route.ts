import { and, asc, eq, lt, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { expenses, paymentMethods, wallets } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { toWalletDto } from '@/lib/http/dto';
import { parseJsonBody } from '@/lib/http/validate';
import { createWalletSchema } from '@/lib/validation/schemas';
import { paymentMethodOwnerFilter } from '@/lib/domain/payment-method-scope';
import { withDisplayBalance } from '@/lib/domain/wallet-balance';

interface Context {
  params: { tripId: string };
}

/**
 * 钱包私有：硬编码 participant_id = 自己，不接受任何客户端传参覆盖这个过滤条件——
 * 跟 CLAUDE.md 权限边界里 expense 查询的规矩是同一条。
 */
export const GET = withSession<Context>(async (_request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const rows = await db
    .select()
    .from(wallets)
    .where(and(eq(wallets.tripId, params.tripId), eq(wallets.participantId, identity.participantId)))
    .orderBy(asc(wallets.createdAt));

  // fix(2026-09-24 第五十轮，"设置当前余额"覆盖式 bug 修复)：已锚定的钱包（做过
  // 至少一次"设置当前余额"）不再直接读 currentBalance 原始存储值，改成现查现算，
  // 见 computeWalletDisplayBalance 顶部大段注释。
  const withBalances = await Promise.all(rows.map((row) => withDisplayBalance(db, row)));
  return NextResponse.json({ wallets: withBalances.map(toWalletDto) });
});

export const POST = withSession<Context>(async (request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const parsed = await parseJsonBody(request, createWalletSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  if (body.paymentMethodId) {
    const owns = await db.query.paymentMethods.findFirst({
      where: and(eq(paymentMethods.id, body.paymentMethodId), paymentMethodOwnerFilter(identity)),
    });
    if (!owns) return NextResponse.json({ error: 'invalid_payment_method' }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const now = new Date();

  // fix(2026-09-24 第三十九轮，团队看板"历史现金消费回溯补算进钱包余额")：创建时如果
  // 直接绑了支付方式，这趟行程里「币种一致 + 这个支付方式 + 这个参与者自己付的」那些
  // 比这个钱包更早存在的消费，这次也一并补扣进起始余额——不再是只对绑定之后新记的
  // 消费生效。匹配条件照抄 `app/api/trips/[tripId]/expenses/route.ts`「记账自动扣
  // 钱包余额」那段的口径（`paymentMethodId` 匹配 + `currency` 精确一致 + 付款人是
  // 这个钱包的主人），唯一新增的判断只是时间方向倒过来：
  // fix(第七十轮)：这里原本用 `enteredByParticipantId` 判断"这个参与者自己记的"，
  // 应该用 `payerParticipantId` 判断"这个参与者自己付的"——道理跟 expenses/route.ts
  // POST 那边同一个 bug、同一次一起修，见 `lib/domain/wallet-balance.ts` 顶部注释。
  // 那边扫「这笔消费发生时，钱包在不在」，这里扫「钱包诞生前，已经有哪些这样的消费」。
  // 用 `expenses.createdAt < now`（这次 INSERT 的时间点）做唯一的分界线：这条线一过，
  // 这个钱包就已经在数据库里存在了，从这一刻起新记的任何消费都归下面那条「记账自动扣」
  // 逻辑管，两条逻辑刚好在这一瞬间接力、不重叠——不需要额外发明一套「这笔算谁扣过」
  // 的状态跟踪，也不用管每笔历史消费各自的 `expenseDate`（用户可能补录成更早的日期，
  // 但那不影响它是不是「钱包诞生前已经存在于系统里」这个事实）。
  //
  // 这次算完直接把这个差额并进 `currentBalance` 一起写进同一条 INSERT（不是先插入
  // 原始余额、再单独一条 UPDATE 补扣），也不需要一个「是否已回溯过」的状态开关——
  // 当前 UI 只有创建钱包这一个时刻能设置 `paymentMethodId`（没有事后改绑的入口，见
  // `wallets/[walletId]/route.ts` PATCH 虽然 API 层技术上接受 `paymentMethodId`，
  // 但没有任何前端调用会传这个字段），所以这段回溯逻辑只会在这条 INSERT 里跑恰好
  // 一次，不存在「同一个钱包被回溯算两次」的路径。`historicalBackfillAppliedAt` 这个
  // 时间戳仍然写下来，留作以后万一真的接了「事后改绑」这个功能时的判断依据（那时候
  // 要在 PATCH 里另外处理"从未绑定→首次绑定"这个转折点的回溯，这次不在范围内，
  // 详见 PENDING-DECISIONS 记录）。
  let backfillAmount = 0;
  if (body.paymentMethodId) {
    const historicalSum = await db
      .select({ total: sql<number>`coalesce(sum(${expenses.amount}), 0)` })
      .from(expenses)
      .where(
        and(
          eq(expenses.tripId, params.tripId),
          eq(expenses.paymentMethodId, body.paymentMethodId),
          eq(expenses.currency, body.currency),
          eq(expenses.payerParticipantId, identity.participantId),
          lt(expenses.createdAt, now)
        )
      );
    backfillAmount = Number(historicalSum[0]?.total ?? 0);
  }

  await db.insert(wallets).values({
    id,
    tripId: params.tripId,
    participantId: identity.participantId,
    label: body.label,
    currency: body.currency,
    emoji: body.emoji,
    currentBalance: body.initialBalance - backfillAmount,
    paymentMethodId: body.paymentMethodId ?? null,
    historicalBackfillAppliedAt: body.paymentMethodId ? now : null,
    createdAt: now,
  });

  const created = await db.query.wallets.findFirst({ where: eq(wallets.id, id) });
  return NextResponse.json({ wallet: toWalletDto(await withDisplayBalance(db, created!)) }, { status: 201 });
});
