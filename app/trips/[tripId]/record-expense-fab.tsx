'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus } from 'lucide-react';

const BASE_BOTTOM_PX = 16; // 跟原本的 1rem 基准一致
const FAB_HEIGHT_PX = 44;
const AVOID_GAP_PX = 12; // 跟被避让内容之间留的安全间距
const HEADER_CLEARANCE_PX = 60; // 上限：再往上抬也不能抬到导航栏区域去

/**
 * FAB 固定在屏幕右下角，理论上可能跟同样落在这块区域的真实内容重叠——
 * 比如参与者列表最后一行的金额，在参与者不多、页面本身不长的行程里，
 * 首屏（没滚动过）就可能被完全挡住（不是滚到底才挡，滚动救不了）。
 * 这不是加 padding 能解的：padding-bottom 只影响滚动范围，不影响首屏
 * scroll=0 时已经渲染在哪个位置的内容。真正需要的是让 FAB 自己让开——
 * 用 [data-fab-avoid] 标记"可能落进这个角落"的内容区块，FAB 侦测到自己
 * 的固定坐标跟这类区块重叠时，往上抬到完全避开这个区块的上边缘（不是
 * 卡在重叠的边界上——那样只会把重叠部分从"盖住下半行"挪成"盖住上半行"，
 * 没有真的解决），不重叠就退回原位，靠 transition 让这个位移看起来是
 * 平滑挪动而不是突然跳动。HEADER_CLEARANCE_PX 是保险丝：万一某个页面的
 * 被避让区块特别高，也不会把 FAB 顶到导航栏那一层去。
 */
export function RecordExpenseFab({ tripId }: { tripId: string }) {
  const pathname = usePathname();
  const [liftPx, setLiftPx] = useState(0);
  const onFormPage =
    pathname.includes('/expenses/new') ||
    pathname.includes('/edit') ||
    pathname.includes('/exchange/new') ||
    // 支付方式设置页自己的主提交按钮("添加支付方式")就在页面底部，
    // 跟 FAB 是同一类"最主要的操作入口"，两个黑色按钮叠在一起容易误触，
    // 处理方式跟记消费/换汇表单一致：这页不需要"记一笔消费"这个快捷入口。
    pathname.includes('/payment-methods');

  useEffect(() => {
    if (onFormPage) return;

    function recompute() {
      const fabTopAtBase = window.innerHeight - BASE_BOTTOM_PX - FAB_HEIGHT_PX;
      const maxAllowedLift = Math.max(0, fabTopAtBase - HEADER_CLEARANCE_PX);
      let maxLift = 0;
      document.querySelectorAll('[data-fab-avoid]').forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.bottom <= 0 || rect.top >= window.innerHeight) return; // 不在视口内，不用管
        // 目标：FAB 的新底边完全在这个区块的上边缘之上（entirely 让开，
        // 不是刚好贴着重叠边界——贴边界只是把"挡下半行"变成"挡上半行"）。
        const neededTop = rect.top - AVOID_GAP_PX - FAB_HEIGHT_PX;
        const lift = fabTopAtBase - neededTop;
        if (lift > maxLift) maxLift = lift;
      });
      setLiftPx(Math.min(maxLift, maxAllowedLift));
    }

    recompute();
    window.addEventListener('scroll', recompute, { passive: true });
    window.addEventListener('resize', recompute);
    return () => {
      window.removeEventListener('scroll', recompute);
      window.removeEventListener('resize', recompute);
    };
  }, [onFormPage, pathname]);

  if (onFormPage) return null;

  return (
    <div
      className="fixed right-4 z-10 transition-[bottom] duration-150"
      style={{ bottom: `calc(1rem + env(safe-area-inset-bottom) + ${liftPx}px)` }}
    >
      <Link
        href={`/trips/${tripId}/expenses/new`}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-accent-700 px-4 text-sm font-medium text-white shadow-lg transition-colors hover:bg-accent-800"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        记一笔消费
      </Link>
    </div>
  );
}
