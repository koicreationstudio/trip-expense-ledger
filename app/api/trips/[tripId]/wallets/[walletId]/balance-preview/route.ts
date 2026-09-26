import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb, type Db } from '@/lib/db/client';
import { wallets } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { parseJsonBody } from '@/lib/http/validate';
import { previewWalletBalanceSchema } from '@/lib/validation/schemas';
import { computeWalletDisplayBalance, withHypotheticalAnchor } from '@/lib/domain/wallet-balance';

interface Context {
  params: { tripId: string; walletId: string };
}

async function loadOwn(db: Db, id: string, tripId: string, participantId: string) {
  return db.query.wallets.findFirst({
    where: and(eq(wallets.id, id), eq(wallets.tripId, tripId), eq(wallets.participantId, participantId)),
  });
}

/**
 * 「设置当前余额」防覆盖确认流程专用（2026-09-26 新增）：纯预览，不写库。
 *
 * 钱包详情页表单第①步（还没填新值）POST 空 body `{}`，只想知道"当前锚点是
 * 多少、生效日是哪天、系统算出来的现余额是多少"——这几个数字光靠列表页
 * GET /wallets 拿不到：那个端点已经把 `currentBalance` 换成推导出来的显示值
 * （见 `withDisplayBalance`），原始锚点数字（`prevAmount`/`prevEffectiveDate`）
 * 早被覆盖掉了，只有这里直接从 DB 读的 `existing` 才留着原始值。
 *
 * 表单第③步"下一步"要看"改完之后会变成多少"时，带上 `newCurrentBalance` +
 * `newBalanceUpdatedAt`，这里再算一次 `displayBalanceAfter`——用的是跟 PATCH
 * 写库时同一个 `computeWalletDisplayBalance`，喂同一份 `existing` 行只是换了
 * `currentBalance`/`balanceUpdatedAt` 两个字段（`withHypotheticalAnchor`），
 * 不是另外发明一套算法猜出来的数字。
 */
export const POST = withSession<Context>(async (request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const existing = await loadOwn(db, params.walletId, params.tripId, identity.participantId);
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const parsed = await parseJsonBody(request, previewWalletBalanceSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  // 「改前」——不管这次要不要预览"改后"，都先算好：钱包从没设置过锚点时
  // （`balanceUpdatedAt` 是 null），`prevAmount`/`prevEffectiveDate` 就是 null，
  // 代表"改前从未设置过"，不是"改前锚点是 0"。
  const prevAmount = existing.balanceUpdatedAt ? existing.currentBalance : null;
  const prevEffectiveDate = existing.balanceUpdatedAt ? existing.balanceUpdatedAt.toISOString() : null;
  const displayBalanceBefore = await computeWalletDisplayBalance(db, existing);

  let displayBalanceAfter: number | null = null;
  if (body.newCurrentBalance !== undefined && body.newBalanceUpdatedAt !== undefined) {
    const hypothetical = withHypotheticalAnchor(existing, body.newCurrentBalance, new Date(body.newBalanceUpdatedAt));
    displayBalanceAfter = await computeWalletDisplayBalance(db, hypothetical);
  }

  return NextResponse.json({ prevAmount, prevEffectiveDate, displayBalanceBefore, displayBalanceAfter });
});
