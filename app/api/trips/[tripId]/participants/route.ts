import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { participants } from '@/lib/db/schema';
import { withTripOwner } from '@/lib/auth/require-session';
import { toParticipantSummaryDto } from '@/lib/http/dto';
import { parseJsonBody } from '@/lib/http/validate';
import { addParticipantSchema } from '@/lib/validation/schemas';

interface Context {
  params: { tripId: string };
}

/**
 * 屏⑥"直接添加参与者"新功能（2026-09-13 落地第四轮拍板）：纯姓名输入框+添加按钮，
 * 没有登录方式——建一个跟"发邀请链接但还没被认领"完全一样形状的 participant 记录
 * （claimedAt 留空、userId 留空），不新造一种"线下参与者"状态，复用现有的
 * "未认领占位"语义。这样"记一笔消费"的分摊名单本来就是从 participants 表读，
 * 加进来的人自动就出现在分摊名单里，不用额外接线。
 * admin 操作，跟邀请管理同一档权限，仅 owner 能做。
 */
export const POST = withTripOwner<Context>(async (request, { params }) => {
  const parsed = await parseJsonBody(request, addParticipantSchema);
  if ('error' in parsed) return parsed.error;

  const db = await getDb();
  const id = crypto.randomUUID();
  await db.insert(participants).values({
    id,
    tripId: params.tripId,
    displayName: parsed.data.displayName,
  });

  const created = await db.query.participants.findFirst({ where: eq(participants.id, id) });
  return NextResponse.json({ participant: toParticipantSummaryDto(created!) }, { status: 201 });
});
