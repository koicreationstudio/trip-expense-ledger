import { and, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { expenses } from '@/lib/db/schema';
import { assertSameTrip, withSession } from '@/lib/auth/require-session';
import { parseJsonBody } from '@/lib/http/validate';
import { reorderExpensesSchema } from '@/lib/validation/schemas';

interface Context {
  params: { tripId: string };
}

/**
 * 活动流拖拽重排（2026-09-26 第七十一轮，任务⑤）——一次提交"拖拽后的新顺序"（这趟
 * 行程手动排序模式下当前可见的全部消费 id，按新顺序排好的数组），后端按数组下标批量
 * 重算 sortOrder（下标本身就是新的相对顺序）。
 *
 * 权限边界：活动流现在是整趟行程共享的一条流水（page.tsx"整个行程的消费都要
 * 看见……不再按 enteredByParticipantId 过滤"，2026-09-19 第二十八轮定案），
 * 任何在这趟行程里的参与者都能看到全部消费、也就能拖拽调整这条共享顺序——这个
 * 端点只校验"这些 id 确实都属于这趟行程"，不额外收窄到"自己录入的"。数组里混进
 * 不属于这趟行程的 id，直接拒绝整个请求（不是静默忽略那几个 id），因为"重排结果
 * 不完整"本身就是一个错误状态，让客户端知道，不要悄悄吞掉。
 */
export const PATCH = withSession<Context>(async (request, { params }, identity) => {
  const denied = assertSameTrip(identity, params.tripId);
  if (denied) return denied;

  const parsed = await parseJsonBody(request, reorderExpensesSchema);
  if ('error' in parsed) return parsed.error;

  const { orderedExpenseIds } = parsed.data;
  const uniqueIds = new Set(orderedExpenseIds);
  if (uniqueIds.size !== orderedExpenseIds.length) {
    return NextResponse.json({ error: 'duplicate_expense_id' }, { status: 400 });
  }

  const db = await getDb();

  const belongsToTrip = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.tripId, params.tripId), inArray(expenses.id, orderedExpenseIds)));

  if (belongsToTrip.length !== orderedExpenseIds.length) {
    return NextResponse.json({ error: 'invalid_expense_id' }, { status: 400 });
  }

  // D1 remote binding 不支持交互式多语句事务，用 batch() 做原子——同一套模式
  // 跟 expenses/route.ts POST 里"新增消费 + 分摊 + 扣钱包"一次 batch 提交一致。
  const statements = orderedExpenseIds.map((expenseId, index) =>
    db.update(expenses).set({ sortOrder: index }).where(eq(expenses.id, expenseId))
  );
  await db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);

  return NextResponse.json({ ok: true });
});
