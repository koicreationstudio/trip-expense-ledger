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

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-base font-semibold text-ink">创建新行程</h1>
      <NewTripForm />
    </main>
  );
}
