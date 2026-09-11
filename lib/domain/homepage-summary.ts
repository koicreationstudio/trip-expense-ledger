/**
 * 首页顶部摘要行要不要显示、显示什么——纯函数，不碰数据库，方便离开真实
 * 数据库也能单测（跟 settlement.ts 同一个套路）。
 *
 * 修复背景（2026-09-10 ui-auditor 真机走查实测复现）：原来的判断条件用的是
 * 「总行程数 >= 2」，但总行程数里混了 settled/archived。1 个进行中行程 +
 * 2 个已结束行程时，总行程数是 3（触发显示），可摘要内容
 * （"1 个行程记账中 · 净该收 RM X"）跟下面唯一那张进行中卡片的内容
 * 一字不差重复了——DESIGN-BRIEF-homepage-redesign.md 说"只有 0-1 个行程时
 * 摘要跟单张卡片信息重复，没必要重复展示"，这句话的论证依据是"重复"，
 * 而会不会重复只取决于进行中(active)行程数，不是总行程数，所以这里判断
 * 阈值要用 activeTrips.length，不是 trips.length。
 */

export interface HomepageTripLike {
  status: string;
  baseCurrency: string;
  netBalance: number;
}

export interface HomepageSummary {
  showSummary: boolean;
  activeCount: number;
  /** 按币种分组的净额加总，只算 active 行程（settled/archived 的钱不该占用「现在该操心多少钱」这条信息） */
  netByCurrency: Map<string, number>;
}

export function computeHomepageSummary(trips: HomepageTripLike[]): HomepageSummary {
  const activeTrips = trips.filter((trip) => trip.status === 'active');

  const netByCurrency = new Map<string, number>();
  for (const trip of activeTrips) {
    netByCurrency.set(trip.baseCurrency, (netByCurrency.get(trip.baseCurrency) ?? 0) + trip.netBalance);
  }

  // 0-1 个进行中行程时摘要跟下面单张卡片重复，不展示；>=2 个才有汇总的意义。
  const showSummary = activeTrips.length >= 2;

  return { showSummary, activeCount: activeTrips.length, netByCurrency };
}
