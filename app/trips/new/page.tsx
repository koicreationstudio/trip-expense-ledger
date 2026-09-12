import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth/current-user';
import { NewTripForm } from './new-trip-form';
import { ProvisionGate } from './provision-gate';

/**
 * 建行程要求先有账号——这是"创建者必须有账号"这条设计原则的落地点。
 * 2026-09-09 第十六轮登录系统换血：不再跳转到 /login，改成没有账号时先渲染
 * ProvisionGate 自动开号（展示专属身份链接要求确认保存），开完号
 * router.refresh() 回来这个 Server Component 会重新查到 user，正常渲染表单。
 */
export default async function NewTripPage() {
  const user = await getCurrentUser();
  if (!user) {
    return <ProvisionGate />;
  }

  // fix(2026-09-12 死路走查)：已有账号时这页直接进 NewTripForm，原本填到一半
  // 改主意也没有退路，只能靠浏览器物理返回键。这页不在 TripLayout 底下（建行程
  // 之前不可能有 tripId），能明确回去的地方只有首页——不管是从首页"创建新行程"
  // 点进来的，还是从某个行程的切换下拉点进来的，首页都是唯一确定回得去的地方。
  return (
    <main className="flex flex-col gap-6">
      <Link href="/" className="tap-link self-start text-[10px] text-muted hover:text-ink">
        ← 返回首页
      </Link>
      <h1 className="text-base font-semibold text-ink">创建新行程</h1>
      <NewTripForm />
    </main>
  );
}
