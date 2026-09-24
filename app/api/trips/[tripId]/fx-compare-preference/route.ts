import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { fxComparePreferences, trips } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { parseJsonBody } from '@/lib/http/validate';
import { fxComparePreferenceSchema } from '@/lib/validation/schemas';
import { centsToYuan, yuanToCents } from '@/lib/money';
import { HOLD_CURRENCY_CANDIDATES, resolveTargetCandidates } from '@/lib/fx/fx-compare-defaults';
import type { AuthenticatedIdentity } from '@/lib/auth/session';

/**
 * 汇率比价卡片"我持有/目标币种/自选比较项/兑换金额"这组选项，2026-09-24
 * Remy 明确要求"按账号×行程记住，换设备也要能恢复"——之前只活在
 * fx-compare-card.tsx 的纯 useState 里，刷新页面就丢。这个路由是唯一的读写口，
 * owner 归属沿用 payment_method 同一套双轨模式（有账号按 user_id，访客按
 * participant_id，见 payment-method-scope.ts），一次只处理"当前登录身份在
 * 这趟行程下"的一份偏好，不接受传别的 tripId/身份进来查/改。
 *
 * 值失效的优雅降级（比如保存时勾的某张卡后来被删了）刻意不在这个路由做——
 * 存什么就原样存、原样吐回去，"存的值现在还有没有意义"完全交给前端渲染时
 * 自然过滤（fx-compare-card.tsx 的 STATIC_CHANNELS.filter/cardRecommendations
 * 过滤逻辑本来就只认识当前真实存在的渠道/卡，认不出的 key 不会渲染出东西，
 * 不会白屏也不会报错），这个路由自己加一层"删除失效 key"的清理反而是额外
 * 复杂度，没有必要。
 */

interface Context {
  params: { tripId: string };
}

function ownerFilter(identity: AuthenticatedIdentity) {
  return identity.userId
    ? eq(fxComparePreferences.userId, identity.userId)
    : eq(fxComparePreferences.participantId, identity.participantId);
}

export const GET = withSession<Context>(async (_request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const row = await db.query.fxComparePreferences.findFirst({
    where: and(eq(fxComparePreferences.tripId, params.tripId), ownerFilter(identity)),
  });

  if (!row) return NextResponse.json({ preference: null });

  return NextResponse.json({
    preference: {
      holdCurrency: row.holdCurrency,
      targetCurrency: row.targetCurrency,
      enabledCompareKeys: row.enabledCompareKeys,
      amountYuan: centsToYuan(row.amountCents),
    },
  });
});

export const PUT = withSession<Context>(async (request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const parsed = await parseJsonBody(request, fxComparePreferenceSchema);
  if ('error' in parsed) return parsed.error;

  // 服务端再校验一遍币种确实在候选池里——前端本来就会对失效值优雅降级不崩，
  // 但没必要让明显不合法的值（比如客户端被篡改过的请求）落进 D1。
  const holdCandidates: readonly string[] = HOLD_CURRENCY_CANDIDATES;
  if (!holdCandidates.includes(parsed.data.holdCurrency)) {
    return NextResponse.json({ error: 'invalid_hold_currency' }, { status: 400 });
  }
  if (!resolveTargetCandidates(parsed.data.holdCurrency).includes(parsed.data.targetCurrency)) {
    return NextResponse.json({ error: 'invalid_target_currency' }, { status: 400 });
  }

  const db = await getDb();
  const trip = await db.query.trips.findFirst({ where: eq(trips.id, params.tripId) });
  if (!trip) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const ownerColumns = identity.userId
    ? { userId: identity.userId, participantId: null }
    : { userId: null, participantId: identity.participantId };

  const values = {
    ...ownerColumns,
    tripId: params.tripId,
    holdCurrency: parsed.data.holdCurrency,
    targetCurrency: parsed.data.targetCurrency,
    enabledCompareKeys: parsed.data.enabledCompareKeys,
    amountCents: yuanToCents(parsed.data.amountYuan),
    updatedAt: new Date(),
  };

  await db
    .insert(fxComparePreferences)
    .values(values)
    .onConflictDoUpdate({
      target: identity.userId
        ? [fxComparePreferences.userId, fxComparePreferences.tripId]
        : [fxComparePreferences.participantId, fxComparePreferences.tripId],
      set: {
        holdCurrency: values.holdCurrency,
        targetCurrency: values.targetCurrency,
        enabledCompareKeys: values.enabledCompareKeys,
        amountCents: values.amountCents,
        updatedAt: values.updatedAt,
      },
    });

  return NextResponse.json({ ok: true });
});
