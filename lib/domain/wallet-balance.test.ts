import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, type Db } from '@/lib/db/client';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';
import { loanRepayments, loans, participants, trips, wallets } from '@/lib/db/schema';
import { computeWalletDisplayBalance } from './wallet-balance';

/**
 * round72b（借钱/还钱功能）：validate lib/domain/wallet-balance.ts 的锚点+推导
 * 公式，加了 loan/loan_repayment 两项之后数学上是对的。走真实 miniflare D1
 * （setupTestDb），不连远程生产库，合成数据，不碰任何真实行程。
 *
 * 每个 test 起独立的 trip/participant/wallet，互不干扰（不共用夹具），方便单看
 * 一条 case 就能确认这条数学关系，不用回头翻上一条 case 建了什么数据。
 */

let db: Db;

beforeAll(async () => {
  await setupTestDb();
  db = await getDb();
});

afterAll(async () => {
  await teardownTestDb();
});

const ANCHOR_DATE = new Date('2026-09-10T00:00:00.000Z');
const AFTER_ANCHOR = new Date('2026-09-11T00:00:00.000Z');
const LATER = new Date('2026-09-12T00:00:00.000Z');

/** 建一趟最小可用行程：1 个 trip + 2 个 participant（出借人/借款人）。 */
async function makeTripWithParticipants() {
  const tripId = crypto.randomUUID();
  await db.insert(trips).values({ id: tripId, name: '测试行程', baseCurrency: 'USD' });
  const lenderId = crypto.randomUUID();
  const borrowerId = crypto.randomUUID();
  await db.insert(participants).values([
    { id: lenderId, tripId, displayName: '出借人', isOwner: true },
    { id: borrowerId, tripId, displayName: '借款人', isOwner: false },
  ]);
  return { tripId, lenderId, borrowerId };
}

/** 建一个已锚定（`balanceUpdatedAt` 非空）的钱包——round55 那套推导公式只在这个模式下生效。 */
async function makeAnchoredWallet(args: {
  tripId: string;
  participantId: string;
  currency: string;
  anchorBalance: number;
  anchorDate?: Date;
}) {
  const walletId = crypto.randomUUID();
  await db.insert(wallets).values({
    id: walletId,
    tripId: args.tripId,
    participantId: args.participantId,
    label: `测试钱包(${args.currency})`,
    currency: args.currency,
    currentBalance: args.anchorBalance,
    balanceUpdatedAt: args.anchorDate ?? ANCHOR_DATE,
  });
  return walletId;
}

async function balanceOf(walletId: string): Promise<number> {
  const wallet = await db.query.wallets.findFirst({ where: eq(wallets.id, walletId) });
  if (!wallet) throw new Error('wallet not found');
  return computeWalletDisplayBalance(db, wallet);
}

async function insertLoan(args: {
  tripId: string;
  lenderId: string;
  borrowerId: string;
  amount: number;
  fromWalletId: string | null;
  date?: Date;
}) {
  const loanId = crypto.randomUUID();
  await db.insert(loans).values({
    id: loanId,
    tripId: args.tripId,
    lenderParticipantId: args.lenderId,
    borrowerParticipantId: args.borrowerId,
    amount: args.amount,
    currency: 'USD',
    fromWalletId: args.fromWalletId,
    date: args.date ?? AFTER_ANCHOR,
  });
  return loanId;
}

async function insertRepayment(args: { loanId: string; amount: number; toWalletId: string | null; date?: Date }) {
  await db.insert(loanRepayments).values({
    id: crypto.randomUUID(),
    loanId: args.loanId,
    amount: args.amount,
    toWalletId: args.toWalletId,
    date: args.date ?? LATER,
  });
}

describe('wallet-balance：loan/loan_repayment 联动（round72b）', () => {
  it('①借出后来源钱包余额按 wallet-balance.ts 推导正确减少', async () => {
    const { tripId, lenderId, borrowerId } = await makeTripWithParticipants();
    const walletId = await makeAnchoredWallet({ tripId, participantId: lenderId, currency: 'USD', anchorBalance: 100000 });

    await insertLoan({ tripId, lenderId, borrowerId, amount: 30000, fromWalletId: walletId });

    expect(await balanceOf(walletId)).toBe(100000 - 30000);
  });

  it('②还款后目标钱包余额正确增加，且可以跟借出不是同一个钱包/同一个币种（真实场景：借出 USD 现金，收回存进 USDT 钱包）', async () => {
    const { tripId, lenderId, borrowerId } = await makeTripWithParticipants();
    const usdWallet = await makeAnchoredWallet({ tripId, participantId: lenderId, currency: 'USD', anchorBalance: 24600 });
    // 注：真实系统里 USDT 钱包的 `currency` 字段存的是 'USD'（USDT 挂钩美元 1:1，
    // 这个 app 的币种校验只认 3 位 ISO 代码，见 lib/validation/schemas.ts 的
    // currencyCode），这里用 'USD' 而不是 'USDT' 字面量正是照真实数据的样子来，
    // 不是随手写的占位符。
    const usdtWallet = await makeAnchoredWallet({
      tripId,
      participantId: lenderId,
      currency: 'USD',
      anchorBalance: -860500,
    });

    const loanId = await insertLoan({ tripId, lenderId, borrowerId, amount: 750000, fromWalletId: usdWallet });
    await insertRepayment({ loanId, amount: 150000, toWalletId: usdtWallet });

    // 借出钱包只受 loan 影响
    expect(await balanceOf(usdWallet)).toBe(24600 - 750000);
    // 收款钱包只受 repayment 影响，跟借出钱包完全独立，币种/钱包都不同也没问题
    expect(await balanceOf(usdtWallet)).toBe(-860500 + 150000);
  });

  it('③部分还款多次累加正确（不是只算最后一笔，也不是覆盖式写入）', async () => {
    const { tripId, lenderId, borrowerId } = await makeTripWithParticipants();
    const toWallet = await makeAnchoredWallet({ tripId, participantId: lenderId, currency: 'USD', anchorBalance: 0 });
    const loanId = await insertLoan({ tripId, lenderId, borrowerId, amount: 100000, fromWalletId: null });

    await insertRepayment({ loanId, amount: 20000, toWalletId: toWallet, date: AFTER_ANCHOR });
    expect(await balanceOf(toWallet)).toBe(20000);

    await insertRepayment({ loanId, amount: 35000, toWalletId: toWallet, date: LATER });
    expect(await balanceOf(toWallet)).toBe(20000 + 35000);

    await insertRepayment({ loanId, amount: 45000, toWalletId: toWallet, date: new Date('2026-09-13T00:00:00.000Z') });
    expect(await balanceOf(toWallet)).toBe(20000 + 35000 + 45000);
  });

  it('④全部还清后，对同一个钱包的净影响精确是 0（借出减多少，还款就加回多少，不多不少）', async () => {
    const { tripId, lenderId, borrowerId } = await makeTripWithParticipants();
    // 故意用同一个钱包既当借出来源又当还款目标：这趟"钱出去又原样回来"的场景，
    // 锚点值本身不该被最终结果动到——验证的正是"减和加严格对称"这件事。
    const walletId = await makeAnchoredWallet({ tripId, participantId: lenderId, currency: 'USD', anchorBalance: 50000 });
    const loanId = await insertLoan({ tripId, lenderId, borrowerId, amount: 40000, fromWalletId: walletId });
    await insertRepayment({ loanId, amount: 40000, toWalletId: walletId });

    expect(await balanceOf(walletId)).toBe(50000);
  });

  it('⑤ fromWalletId 为 null 时不影响任何钱包余额（“不经过任何钱包的现金往来”）', async () => {
    const { tripId, lenderId, borrowerId } = await makeTripWithParticipants();
    const unrelatedWallet = await makeAnchoredWallet({
      tripId,
      participantId: lenderId,
      currency: 'USD',
      anchorBalance: 12345,
    });

    await insertLoan({ tripId, lenderId, borrowerId, amount: 90000, fromWalletId: null });

    expect(await balanceOf(unrelatedWallet)).toBe(12345);
  });

  it('⑤ toWalletId 为 null 时不影响任何钱包余额', async () => {
    const { tripId, lenderId, borrowerId } = await makeTripWithParticipants();
    const unrelatedWallet = await makeAnchoredWallet({
      tripId,
      participantId: lenderId,
      currency: 'USD',
      anchorBalance: 999,
    });
    const loanId = await insertLoan({ tripId, lenderId, borrowerId, amount: 90000, fromWalletId: null });

    await insertRepayment({ loanId, amount: 30000, toWalletId: null });

    expect(await balanceOf(unrelatedWallet)).toBe(999);
  });

  it('锚点生效日之前发生的 loan/repayment 不计入（跟 expense/exchangeRecord 同一条 `>=` 边界规矩）', async () => {
    const { tripId, lenderId, borrowerId } = await makeTripWithParticipants();
    const walletId = await makeAnchoredWallet({
      tripId,
      participantId: lenderId,
      currency: 'USD',
      anchorBalance: 5000,
      anchorDate: ANCHOR_DATE,
    });
    const beforeAnchor = new Date('2026-09-01T00:00:00.000Z');

    await insertLoan({ tripId, lenderId, borrowerId, amount: 1000, fromWalletId: walletId, date: beforeAnchor });

    // 锚点值本身已经是"那一天的余额"，锚点之前发生的流水不该再被重复扣一次。
    expect(await balanceOf(walletId)).toBe(5000);
  });

  it('未锚定的钱包（balanceUpdatedAt 为 null）原样返回 currentBalance，不受这套推导影响（另一套模式，见函数顶部注释）', async () => {
    const { tripId, lenderId, borrowerId } = await makeTripWithParticipants();
    const walletId = crypto.randomUUID();
    await db.insert(wallets).values({
      id: walletId,
      tripId,
      participantId: lenderId,
      label: '未锚定钱包',
      currency: 'USD',
      currentBalance: 7777,
      balanceUpdatedAt: null,
    });

    await insertLoan({ tripId, lenderId, borrowerId, amount: 1000, fromWalletId: walletId });

    // 未锚定模式下这个函数不会去查 loan/loanRepayment 表，直接原样返回
    // wallet.currentBalance——真实的扣款要靠 API 路由写时直接改这个字段
    // （见 app/api/trips/[tripId]/loans/route.ts POST），不是这个函数的职责。
    expect(await balanceOf(walletId)).toBe(7777);
  });
});
