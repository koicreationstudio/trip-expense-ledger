import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { exchangeRecords, wallets } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { toExchangeRecordDto } from '@/lib/http/dto';
import { parseJsonBody } from '@/lib/http/validate';
import { createExchangeRecordSchema } from '@/lib/validation/schemas';

interface Context {
  params: { tripId: string };
}

/** 换汇记录私有，规矩跟 wallet 一致：硬编码 participant_id = 自己。 */
export const GET = withSession<Context>(async (_request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const rows = await db
    .select()
    .from(exchangeRecords)
    .where(and(eq(exchangeRecords.tripId, params.tripId), eq(exchangeRecords.participantId, identity.participantId)))
    .orderBy(desc(exchangeRecords.exchangeDate));

  return NextResponse.json({ exchangeRecords: rows.map(toExchangeRecordDto) });
});

export const POST = withSession<Context>(async (request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const parsed = await parseJsonBody(request, createExchangeRecordSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  const toWallet = await db.query.wallets.findFirst({
    where: and(
      eq(wallets.id, body.toWalletId),
      eq(wallets.tripId, params.tripId),
      eq(wallets.participantId, identity.participantId)
    ),
  });
  if (!toWallet) return NextResponse.json({ error: 'invalid_to_wallet' }, { status: 400 });

  let fromWallet = null;
  if (body.fromWalletId) {
    fromWallet = await db.query.wallets.findFirst({
      where: and(
        eq(wallets.id, body.fromWalletId),
        eq(wallets.tripId, params.tripId),
        eq(wallets.participantId, identity.participantId)
      ),
    });
    if (!fromWallet) return NextResponse.json({ error: 'invalid_from_wallet' }, { status: 400 });
  }

  const id = crypto.randomUUID();

  const insertRecord = db.insert(exchangeRecords).values({
    id,
    tripId: params.tripId,
    participantId: identity.participantId,
    fromWalletId: body.fromWalletId ?? null,
    toWalletId: body.toWalletId,
    fromAmount: body.fromAmount ?? null,
    toAmount: body.toAmount,
    exchangeDate: new Date(body.exchangeDate),
    note: body.note ?? null,
  });

  // fix(2026-09-24 第五十轮，"设置当前余额"覆盖式 bug 修复)：跟 expenses/route.ts
  // POST 同一条规矩——钱包一旦做过至少一次"设置当前余额"（`balanceUpdatedAt` 非空），
  // 切换进 lib/domain/wallet-balance.ts 的"锚点+推导"模式，这里就不再直接写一次
  // currentBalance 增量，交给读取时的推导公式现查现算（这条换汇记录本身的行还在，
  // exchangeDate/toWalletId/fromWalletId 会被那条 SQL 自动捞到）。只有还没设置过
  // 的钱包（旧的可变累加字段模式）才继续走原来这条直接写入的路径。
  const statements: unknown[] = [insertRecord];
  if (toWallet.balanceUpdatedAt === null) {
    statements.push(
      db
        .update(wallets)
        .set({ currentBalance: toWallet.currentBalance + body.toAmount })
        .where(eq(wallets.id, toWallet.id))
    );
  }
  if (fromWallet && body.fromAmount !== undefined && fromWallet.balanceUpdatedAt === null) {
    statements.push(
      db
        .update(wallets)
        .set({ currentBalance: fromWallet.currentBalance - body.fromAmount })
        .where(eq(wallets.id, fromWallet.id))
    );
  }

  // 原子写入：一笔换汇记录 + 最多两个钱包余额更新（已锚定的钱包不需要这条更新
  // 语句，见上），各条语句互不依赖对方执行结果，符合 D1 batch() 的用法（remote
  // binding 不支持交互式事务，CLAUDE.md 已定这条规矩）。数组长度视两个钱包各自
  // 是否已锚定而变化，跟 expenses/[expenseId]/route.ts PATCH 里同款写法一样做
  // 运行时断言。
  await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);

  const created = await db.query.exchangeRecords.findFirst({ where: eq(exchangeRecords.id, id) });
  return NextResponse.json({ exchangeRecord: toExchangeRecordDto(created!) }, { status: 201 });
});
