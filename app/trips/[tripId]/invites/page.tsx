import { redirect } from 'next/navigation';
import { getCurrentIdentity } from '@/lib/auth/current-session';
import { InvitesManager } from './invites-manager';

export default async function InvitesPage({ params }: { params: { tripId: string } }) {
  const identity = await getCurrentIdentity();
  if (!identity || identity.tripId !== params.tripId) {
    redirect('/');
  }
  if (!identity.isOwner) {
    redirect(`/trips/${params.tripId}`);
  }

  return (
    // fix(2026-09-16 第十七轮，Remy 反馈"不只首页，其它屏也一样"后逐屏比对发现的漂移)：
    // 标题 text-base(16px) 是历史孤例——settlement/payment-methods/account 三个页面
    // 早在之前几轮就已经改成 text-[15px] 对齐 Artifact `.title-block h3`，这个页面漏改了。
    // gap-8(32px) 同理，标题到正文之间没必要空这么开，收到 gap-3.5(14px) 跟 Artifact
    // `.title-block` margin-bottom:14px 对齐，也跟其它屏这次一起收紧的间距同一个量级。
    <main className="flex flex-col gap-3.5">
      <h1 className="text-[15px] font-semibold text-ink">邀请管理</h1>
      <InvitesManager tripId={params.tripId} />
    </main>
  );
}
