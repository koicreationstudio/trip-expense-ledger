import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import { getCurrentIdentity } from '@/lib/auth/current-session';
import { getCurrentUser } from '@/lib/auth/current-user';
import { loadUserTripsWithBalance } from '@/lib/db/user-trips-query';
import { computeHomepageSummary } from '@/lib/domain/homepage-summary';
import { formatMoney } from '@/lib/money';
import { MyTrips } from './my-trips';

export default async function HomePage({ searchParams }: { searchParams?: { identity_invalid?: string } }) {
  // ① tel_session 有效 → 跟今天一样直接跳进那个 trip，guest 零摩擦流程原样保留。
  const identity = await getCurrentIdentity();
  if (identity) {
    redirect(`/trips/${identity.tripId}`);
  }

  // ② 否则查 tel_user_session，有效就查这个账号建过/认领过的行程，画"我的行程"列表。
  const user = await getCurrentUser();
  if (user) {
    const db = await getDb();
    // 余额优先原则延伸到列表页：每张行程卡片顺手标一下当前用户在这个行程里的净额，
    // 让"要不要点进去看"提前到列表页就能判断，不用逐个点进去才知道。
    const tripsWithBalance = await loadUserTripsWithBalance(db, user.userId);

    // 顶部欢迎摘要：只聚合"记账中"的行程（已结算/已归档的钱不该再占用"现在该操心
    // 多少钱"这条信息，DESIGN-BRIEF-homepage-redesign.md 视觉决定第1条）。
    // 各行程本位币可能不同，不能直接把不同币种的净额加在一起，按币种分组各自求和，
    // 摘要里按币种分别列出（只有 1 个币种时就是一句话，多币种时用 · 分隔）。
    // 是否显示、按币种加总都交给纯函数算，判断阈值用「进行中行程数」而不是
    // 「总行程数」——否则已结算/已归档行程会掺进阈值判断，导致摘要跟唯一一张
    // 进行中卡片重复展示（见 lib/domain/homepage-summary.ts 顶部注释）。
    const { showSummary, activeCount, netByCurrency } = computeHomepageSummary(tripsWithBalance);

    return (
      // fix(2026-09-16 第十七轮)：gap-6(24px) 收到 gap-3.5(14px)，跟其它屏这轮统一收紧
      // 的"标题到正文"间距对齐。
      <main className="flex flex-col gap-3.5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[15px] font-semibold text-ink">我的行程</h1>
            {showSummary && (
              <p className="mt-0.5 text-[10px] text-muted">
                {activeCount} 个行程记账中
                {[...netByCurrency.entries()].map(([currency, net]) => (
                  <span key={currency}>
                    {' · '}
                    {net >= 0 ? '净该收' : '净该付'}{' '}
                    <span className={`font-serif tabular-nums ${net >= 0 ? 'text-positive' : 'text-negative'}`}>
                      {formatMoney(Math.abs(net), currency)}
                    </span>
                  </span>
                ))}
              </p>
            )}
            <Link href="/account" className="mt-1 inline-block text-[10px] text-muted hover:text-ink hover:underline">
              我的账号
            </Link>
          </div>
          {/* fix(2026-09-17 第十九轮)：Artifact `.trip-pill` 文案是"＋ 创建新行程"，带
              加号——之前漏了这个加号。 */}
          <Link
            href="/trips/new"
            className="btn-primary"
          >
            ＋ 创建新行程
          </Link>
        </div>
        <MyTrips trips={tripsWithBalance} />
      </main>
    );
  }

  // ③ 都没有 → 2026-09-09 第十六轮登录系统换血：不再要求先跳 /login，
  // 直接进 /trips/new，没账号会在那里自动开号（见 ProvisionGate）。
  return (
    // fix(2026-09-16 第十七轮)：gap-6(24px) 收到 gap-3.5(14px)，标题字号 text-base(16px)
    // 改 text-[15px]，跟本站其它屏的标题规格统一（这个未登录态入口页之前漏掉了）。
    <main className="flex flex-col gap-3.5">
      {searchParams?.identity_invalid && (
        <p className="rounded-xl border border-sand bg-[rgba(164,163,160,.14)] px-[9px] py-[5px] text-[10px] text-coral">
          这条身份链接无效或已失效，请重新确认链接是否正确。
        </p>
      )}
      <div>
        {/* fix(2026-09-18，第二十六轮全量复核)：同 account/page.tsx 那条注释，跨屏字重
            不一致，改成 font-bold 对齐 Artifact `.title-block h3{font-weight:700}`。上面
            "我的行程"那个 h1 不动——DESIGN-BRIEF-homepage-redesign.md 第86行明确记录
            "继续 text-base font-semibold"是刻意保留的决定，不是漏改，这条不受这次改动影响。 */}
        <h1 className="text-[15px] font-bold text-ink">消费记录</h1>
        <p className="mt-2 text-[10px] text-muted">
          出差记账 + 同行人代垫结清 + 汇率比对，帮你算清这笔该用哪张卡最划算。数据只存在你自己部署的服务器上。
        </p>
      </div>
      <Link
        href="/trips/new"
        className="big-cta"
      >
        创建新行程
      </Link>
      <p className="text-[10px] text-muted">已经有专属身份链接？直接打开那条链接就能回到你的账号。</p>
      <p className="text-[10px] text-muted">已经有同行人分享给你的邀请链接？直接打开那个链接就能认领身份。</p>
    </main>
  );
}
