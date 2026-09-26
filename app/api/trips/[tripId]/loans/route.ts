import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { loanRepayments, loans, participants, trips, wallets } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { toLoanDto } from '@/lib/http/dto';
import { parseJsonBody } from '@/lib/http/validate';
import { createLoanSchema } from '@/lib/validation/schemas';
import { computeLoanProgress } from '@/lib/domain/loan';

interface Context {
  params: { tripId: string };
}

/**
 * round72b 新增：借钱/还钱功能，跟 expense/expense_split 完全独立的一张新表
 * （见 lib/db/schema.ts loan/loan_repayment 顶部大段注释），不参与 Hero 卡
 * "我承担"、活动流、结算净额这几处既有计算。
 *
 * 私密边界跟 expense/wallet 这些既有资源不是同一种：expense 按
 * enteredByParticipantId 收窄成"我自己录的"，wallet/exchangeRecord 按
 * participantId 收窄成"我自己名下的"——loan 天然是两个人的事（谁借给谁），
 * 这里收窄成"我是这笔的当事人之一（lender 或 borrower）"，不是随便哪个 trip
 * 参与者都能看见所有人的借款往来。这是这次的产品判断（没有已有先例可以照抄），
 * 需要 Remy/PM 确认认不认可——见汇报里的开放问题。
 */
export const GET = withSession<Context>(async (_request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const myLoans = await db
    .select()
    .from(loans)
    .where(
      and(
        eq(loans.tripId, params.tripId),
        or(eq(loans.lenderParticipantId, identity.participantId), eq(loans.borrowerParticipantId, identity.participantId))
      )
    )
    .orderBy(desc(loans.date));

  const loanIds = myLoans.map((l) => l.id);
  const repaymentSums = new Map<string, number>();
  if (loanIds.length > 0) {
    const rows = await db
      .select({ loanId: loanRepayments.loanId, total: sql<number>`coalesce(sum(${loanRepayments.amount}), 0)` })
      .from(loanRepayments)
      .where(inArray(loanRepayments.loanId, loanIds))
      .groupBy(loanRepayments.loanId);
    // round74：loanId 改可空之后（支持"不挂具体借款"的还款），groupBy 出来的行
    // 理论上不会出现 loanId=null（这条查询本身就是拿"确定存在的 loanIds" 去
    // inArray 收窄），但类型上已经允许 null——这里加一道显式判断，不挂具体 loan
    // 的还款不计入任何一笔 loan 自己的还款进度，语义上也说得通。
    for (const r of rows) if (r.loanId) repaymentSums.set(r.loanId, Number(r.total));
  }

  return NextResponse.json({
    loans: myLoans.map((l) => ({
      ...toLoanDto(l),
      // 这轮只做"汇总展示"（开放问题②：逐笔还款历史明细这轮不做），progress 里
      // 只带聚合后的 repaidAmount/百分比/状态，不带每一笔 repayment 的明细行。
      progress: computeLoanProgress(l.amount, [{ amount: repaymentSums.get(l.id) ?? 0 }]),
    })),
  });
});

export const POST = withSession<Context>(async (request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const parsed = await parseJsonBody(request, createLoanSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  if (body.lenderParticipantId === body.borrowerParticipantId) {
    return NextResponse.json({ error: 'lender_borrower_same' }, { status: 400 });
  }

  const trip = await db.query.trips.findFirst({ where: eq(trips.id, params.tripId) });
  if (!trip) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // round74：接入结算净额计算需要固化本位币金额，跟 expenses/route.ts POST
  // 同一套 fxRateUsed 必填校验（currency !== trip.baseCurrency 时）。
  let fxRateUsed = 1;
  let amountBaseCurrency = body.amount;
  if (body.currency !== trip.baseCurrency) {
    if (body.fxRateUsed === undefined) {
      return NextResponse.json({ error: 'fx_rate_required' }, { status: 400 });
    }
    fxRateUsed = body.fxRateUsed;
    amountBaseCurrency = Math.round(body.amount * fxRateUsed);
  }

  const tripParticipants = await db.select().from(participants).where(eq(participants.tripId, params.tripId));
  const participantIds = new Set(tripParticipants.map((p) => p.id));
  if (!participantIds.has(body.lenderParticipantId)) {
    return NextResponse.json({ error: 'invalid_lender' }, { status: 400 });
  }
  if (!participantIds.has(body.borrowerParticipantId)) {
    return NextResponse.json({ error: 'invalid_borrower' }, { status: 400 });
  }

  // fromWalletId 可为空（开放问题①"不经过任何钱包的现金往来"）。选了就必须是
  // 当前登录这个人自己名下的钱包——跟 exchange-records/route.ts POST 同一条
  // 规矩（钱包私有，只能动自己的），不是"lenderParticipantId 名下的钱包"，因为
  // 借出去的钱是谁在操作这个 app、谁的钱包被扣，是"谁在录这笔"而不是"谁是
  // lender"（多数场景两者是同一人，但不强制要求相等——比如同行人借钱给 Remy，
  // Remy 帮忙代录，这时 lenderParticipantId 是同行人、fromWalletId 留空，因为
  // 同行人在这个系统里没有可追踪的钱包）。
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
  const insertLoan = db.insert(loans).values({
    id,
    tripId: params.tripId,
    lenderParticipantId: body.lenderParticipantId,
    borrowerParticipantId: body.borrowerParticipantId,
    amount: body.amount,
    currency: body.currency,
    amountBaseCurrency,
    fxRateUsed,
    fxRateSource: 'manual',
    fromWalletId: body.fromWalletId ?? null,
    date: new Date(body.date),
    note: body.note ?? null,
  });

  // 借出当下即时扣钱包——跟 expenses/route.ts POST 的直接扣款路径同一条规矩：
  // 钱包一旦做过至少一次"设置当前余额"（`balanceUpdatedAt` 非空），切换进
  // lib/domain/wallet-balance.ts 的"锚点+推导"模式，这里就不再直接写一次
  // currentBalance 增量，交给读取时的推导公式（已经在那个文件里扩展好认识
  // loan 表）自动算进去。只有还没设置过的钱包才继续走这里直接写入的路径。
  const statements: unknown[] = [insertLoan];
  if (fromWallet && fromWallet.balanceUpdatedAt === null) {
    statements.push(
      db
        .update(wallets)
        .set({ currentBalance: fromWallet.currentBalance - body.amount })
        .where(eq(wallets.id, fromWallet.id))
    );
  }

  await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);

  const created = await db.query.loans.findFirst({ where: eq(loans.id, id) });
  return NextResponse.json(
    { loan: { ...toLoanDto(created!), progress: computeLoanProgress(created!.amount, []) } },
    { status: 201 }
  );
});
