import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { settlementConfirmations } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { parseJsonBody } from '@/lib/http/validate';
import { settlementConfirmationSchema } from '@/lib/validation/schemas';

interface Context {
  params: { tripId: string };
}

/**
 * 结算页"转账清单"按笔勾选收款（2026-09-13 落地第四轮拍板屏④）。只有 toParticipantId
 * 本人（收钱的那一方）能确认/取消确认——不能由付钱方替对方标记"我已经收到钱了"，
 * 这是这个功能唯一的权限判断，identity 一定是这个 trip 里的某个 participant
 * （withSession + assertSameTrip 已经保证），但不一定就是 toParticipantId 本人。
 *
 * 行存在=已确认，不存在=未确认（唯一索引 tripId+from+to+currency 保证幂等，重复
 * POST 不报错、不产生重复行）。
 *
 * fix(2026-09-26，"结算按币种拆开显示")：现在必须带 currency，一对 from/to 下
 * 每个币种各自一条独立的确认状态——htoo 还清 HKD 那笔不代表 MYR/CNY 也还清了。
 */
export const POST = withSession<Context>(async (request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const parsed = await parseJsonBody(request, settlementConfirmationSchema);
  if ('error' in parsed) return parsed.error;
  const { fromParticipantId, toParticipantId, currency } = parsed.data;

  if (identity.participantId !== toParticipantId) {
    return NextResponse.json({ error: 'only_receiver_can_confirm' }, { status: 403 });
  }

  const db = await getDb();
  const existing = await db.query.settlementConfirmations.findFirst({
    where: and(
      eq(settlementConfirmations.tripId, params.tripId),
      eq(settlementConfirmations.fromParticipantId, fromParticipantId),
      eq(settlementConfirmations.toParticipantId, toParticipantId),
      eq(settlementConfirmations.currency, currency)
    ),
  });
  if (!existing) {
    await db.insert(settlementConfirmations).values({
      tripId: params.tripId,
      fromParticipantId,
      toParticipantId,
      currency,
    });
  }

  return NextResponse.json({ confirmed: true });
});

export const DELETE = withSession<Context>(async (request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const parsed = await parseJsonBody(request, settlementConfirmationSchema);
  if ('error' in parsed) return parsed.error;
  const { fromParticipantId, toParticipantId, currency } = parsed.data;

  if (identity.participantId !== toParticipantId) {
    return NextResponse.json({ error: 'only_receiver_can_unconfirm' }, { status: 403 });
  }

  const db = await getDb();
  await db
    .delete(settlementConfirmations)
    .where(
      and(
        eq(settlementConfirmations.tripId, params.tripId),
        eq(settlementConfirmations.fromParticipantId, fromParticipantId),
        eq(settlementConfirmations.toParticipantId, toParticipantId),
        eq(settlementConfirmations.currency, currency)
      )
    );

  return NextResponse.json({ confirmed: false });
});
