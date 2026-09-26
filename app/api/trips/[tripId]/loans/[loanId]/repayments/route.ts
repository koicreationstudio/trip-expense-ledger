import { and, eq, or, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { loanRepayments, loans, wallets } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { toLoanRepaymentDto } from '@/lib/http/dto';
import { parseJsonBody } from '@/lib/http/validate';
import { createLoanRepaymentSchema } from '@/lib/validation/schemas';
import { computeLoanProgress } from '@/lib/domain/loan';

interface Context {
  params: { tripId: string; loanId: string };
}

/**
 * 一笔 loan 的还款记录，支持多次部分还款——见 lib/db/schema.ts loan_repayment
 * 顶部注释和 ../route.ts 顶部关于私密边界的说明（当事人之一才能看/记）。
 */
export const POST = withSession<Context>(async (request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const loan = await db.query.loans.findFirst({
    where: and(
      eq(loans.id, params.loanId),
      eq(loans.tripId, params.tripId),
      or(eq(loans.lenderParticipantId, identity.participantId), eq(loans.borrowerParticipantId, identity.participantId))
    ),
  });
  if (!loan) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const parsed = await parseJsonBody(request, createLoanRepaymentSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  // toWalletId 可为空（同 loan.fromWalletId 那条开放问题①），选了就必须是当前
  // 登录这个人自己名下的钱包，跟 ../route.ts POST 里 fromWalletId 的校验同一条规矩。
  let toWallet = null;
  if (body.toWalletId) {
    toWallet = await db.query.wallets.findFirst({
      where: and(
        eq(wallets.id, body.toWalletId),
        eq(wallets.tripId, params.tripId),
        eq(wallets.participantId, identity.participantId)
      ),
    });
    if (!toWallet) return NextResponse.json({ error: 'invalid_to_wallet' }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const insertRepayment = db.insert(loanRepayments).values({
    id,
    loanId: params.loanId,
    amount: body.amount,
    toWalletId: body.toWalletId ?? null,
    date: new Date(body.date),
    note: body.note ?? null,
  });

  // 还款到账即时加钱包——同 ../route.ts POST 那段注释，只有还没设置过"当前余额"
  // 的钱包（未锚定模式）才在这里直接写一次增量，已锚定的交给
  // lib/domain/wallet-balance.ts 的推导公式（已经认识 loan_repayment 表）自动算。
  const statements: unknown[] = [insertRepayment];
  if (toWallet && toWallet.balanceUpdatedAt === null) {
    statements.push(
      db
        .update(wallets)
        .set({ currentBalance: toWallet.currentBalance + body.amount })
        .where(eq(wallets.id, toWallet.id))
    );
  }

  await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);

  const created = await db.query.loanRepayments.findFirst({ where: eq(loanRepayments.id, id) });

  // 一并把这笔还款之后、这笔 loan 最新的还款进度带回去，前端提交完不用再发一次
  // GET 才能刷新进度条数字。
  const sumRows = await db
    .select({ total: sql<number>`coalesce(sum(${loanRepayments.amount}), 0)` })
    .from(loanRepayments)
    .where(eq(loanRepayments.loanId, params.loanId));
  const repaidAmount = Number(sumRows[0]?.total ?? 0);

  return NextResponse.json(
    {
      repayment: toLoanRepaymentDto(created!),
      progress: computeLoanProgress(loan.amount, [{ amount: repaidAmount }]),
    },
    { status: 201 }
  );
});
