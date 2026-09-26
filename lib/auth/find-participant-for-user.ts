import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { participants } from '../db/schema';

/**
 * 「这个 Layer 2 账号在这趟行程里对应哪个 participant」——之前只有
 * `app/api/account/switch-trip/route.ts` 一处这么查，round72 新增
 * `app/api/account/auto-switch-trip/[tripId]/route.ts` 也需要一模一样的判断
 * （见那个文件顶部注释的根因说明），抽成共享函数，不要两处各写一份同样的查询。
 */
export async function findParticipantForUserInTrip(db: Db, userId: string, tripId: string) {
  return db.query.participants.findFirst({
    where: and(eq(participants.userId, userId), eq(participants.tripId, tripId)),
  });
}
