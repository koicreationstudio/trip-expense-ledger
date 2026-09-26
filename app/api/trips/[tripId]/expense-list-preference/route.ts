import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { expenseListPreferences } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { parseJsonBody } from '@/lib/http/validate';
import { expenseListPreferenceSchema } from '@/lib/validation/schemas';
import type { AuthenticatedIdentity } from '@/lib/auth/session';

/**
 * 活动流（expense-list.tsx）排序模式 + 4 个筛选条件，2026-09-26 第七十一轮任务⑥
 * 新增——"只在真的改动时才写，不要零交互也 PUT"这条要求跟 fx_compare_preference
 * 完全同一套模式（owner 双轨归属 + 前端 hasUserInteractedRef + 这个路由本身"存
 * 什么吐什么"不做优雅降级判断，交给前端渲染自然过滤失效值），细节见
 * `fx-compare-preference/route.ts` 顶部大注释，这里不重复抄一遍。
 */

interface Context {
  params: { tripId: string };
}

function ownerFilter(identity: AuthenticatedIdentity) {
  return identity.userId
    ? eq(expenseListPreferences.userId, identity.userId)
    : eq(expenseListPreferences.participantId, identity.participantId);
}

export const GET = withSession<Context>(async (_request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const db = await getDb();
  const row = await db.query.expenseListPreferences.findFirst({
    where: and(eq(expenseListPreferences.tripId, params.tripId), ownerFilter(identity)),
  });

  if (!row) return NextResponse.json({ preference: null });

  return NextResponse.json({
    preference: {
      sortMode: row.sortMode,
      categoryFilter: row.categoryFilter,
      payerFilter: row.payerFilter,
      dateFilter: row.dateFilter,
      paymentMethodFilter: row.paymentMethodFilter,
      splitFilter: row.splitFilter,
    },
  });
});

export const PUT = withSession<Context>(async (request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const parsed = await parseJsonBody(request, expenseListPreferenceSchema);
  if ('error' in parsed) return parsed.error;

  const db = await getDb();

  const ownerColumns = identity.userId
    ? { userId: identity.userId, participantId: null }
    : { userId: null, participantId: identity.participantId };

  const values = {
    ...ownerColumns,
    tripId: params.tripId,
    sortMode: parsed.data.sortMode,
    categoryFilter: parsed.data.categoryFilter,
    payerFilter: parsed.data.payerFilter,
    dateFilter: parsed.data.dateFilter,
    paymentMethodFilter: parsed.data.paymentMethodFilter,
    splitFilter: parsed.data.splitFilter,
    updatedAt: new Date(),
  };

  await db
    .insert(expenseListPreferences)
    .values(values)
    .onConflictDoUpdate({
      target: identity.userId
        ? [expenseListPreferences.userId, expenseListPreferences.tripId]
        : [expenseListPreferences.participantId, expenseListPreferences.tripId],
      set: {
        sortMode: values.sortMode,
        categoryFilter: values.categoryFilter,
        payerFilter: values.payerFilter,
        dateFilter: values.dateFilter,
        paymentMethodFilter: values.paymentMethodFilter,
        splitFilter: values.splitFilter,
        updatedAt: values.updatedAt,
      },
    });

  return NextResponse.json({ ok: true });
});
