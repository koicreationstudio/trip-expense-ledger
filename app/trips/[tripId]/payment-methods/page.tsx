import { redirect } from 'next/navigation';
import { getCurrentIdentity } from '@/lib/auth/current-session';
import { PaymentMethodsManager } from './payment-methods-manager';

export default async function PaymentMethodsPage({ params }: { params: { tripId: string } }) {
  const identity = await getCurrentIdentity();
  if (!identity || identity.tripId !== params.tripId) {
    redirect('/');
  }

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="text-base font-semibold text-ink">支付方式设置</h1>
        <p className="mt-1 text-[10px] text-muted">
          支付方式挂在你自己身上，跟人走不跟行程走，用来算记账时哪张卡/现金最划算。
        </p>
      </div>
      <PaymentMethodsManager />
    </main>
  );
}
