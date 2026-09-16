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
        <h1 className="text-[15px] font-semibold text-ink">支付方式</h1>
        <p className="mt-1 text-[10px] text-muted">
          支付方式挂在你自己身上，跟人走不跟行程走，用来算记账时哪张卡/现金最划算。
        </p>
      </div>
      <PaymentMethodsManager tripId={params.tripId} />
    </main>
  );
}
