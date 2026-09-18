import { redirect } from 'next/navigation';
import { getCurrentIdentity } from '@/lib/auth/current-session';
import { PaymentMethodsManager } from './payment-methods-manager';

export default async function PaymentMethodsPage({ params }: { params: { tripId: string } }) {
  const identity = await getCurrentIdentity();
  if (!identity || identity.tripId !== params.tripId) {
    redirect('/');
  }

  return (
    // fix(2026-09-16 第十七轮)：gap-6(24px) 收到 gap-3.5(14px)，理由同 settlement/page.tsx。
    <main className="flex flex-col gap-3.5">
      <div>
        {/* fix(2026-09-14 第四轮走查)：Artifact 这一屏标题是"支付方式"（15px，跟其它屏
            标题一致），这里之前是"支付方式设置"，文案跟 Artifact 对不上；15px 跟本站
            其它屏标题（我的行程/我的账号也是 text-[15px]）实际是同一档，这里之前用
            text-base（16px）看着比旁边字号大一截，改成 text-[15px] 对齐。 */}
        {/* fix(2026-09-18，第二十六轮全量复核)：同 settlement/page.tsx 那条注释，跨屏字重
            不一致，改成 font-bold 对齐 Artifact `.title-block h3{font-weight:700}`。 */}
        <h1 className="text-[15px] font-bold text-ink">支付方式</h1>
        {/* fix(2026-09-16 第十八轮，Remy 拍板"跟着方案为准"，逐字抄 Artifact V10
            "05 支付方式"屏原文，不再意译)：`<p style="font-size:10.5px;
            color:var(--gold-dk)">支付方式挂在你自己身上，跟着你走，不跟着行程走——
            这趟旅行结束了，卡的设定还留着，下一趟行程一样能直接用。</p>`，字号/颜色
            也一并对齐（10.5px / gold-dk，之前是 10px / muted，两个颜色虽然同色号但
            这次统一按 spec 语义写）。 */}
        <p className="mt-1 text-[10.5px] text-gold-dk">
          支付方式挂在你自己身上，跟着你走，不跟着行程走——这趟旅行结束了，卡的设定还留着，下一趟行程一样能直接用。
        </p>
      </div>
      <PaymentMethodsManager tripId={params.tripId} />
    </main>
  );
}
