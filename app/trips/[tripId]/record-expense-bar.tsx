'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useDismissableOpen } from '@/components/select-dropdown';

/**
 * 底部「记一笔消费」操作条。
 *
 * ## 为什么不再是悬浮 FAB（2026-09-12 第三次同类反馈后改的结构）
 *
 * 这个位置以前是个贴右下角的悬浮胶囊（`fixed right-4 bottom-4`），它跟页面内容
 * 抢同一块屏幕坐标，被反馈遮挡过三轮：第一轮挡列表行尾的编辑/删除图标，第二轮挡
 * 参与者整行金额，第三轮（420×843 真机截图）挡「当前汇率比价」展开后的比价行。
 * 前两轮的补法都是"给被挡的那个区块打一个 `data-fab-avoid` 标记，让胶囊运行时
 * 量重叠、自己往上抬"。这个补法有两个结构性问题，第三轮实测数据把两个都钉死了：
 *
 * 1. **登记是手动的，所以一定会漏。** 第三轮实测（420×843，scroll=0）：胶囊
 *    rect top=783 bottom=827 left=278 right=404，被挡的那个比价行 rect
 *    top=763.9 bottom=825.9 left=33 right=387，实打实重叠 109×42.9px；而同一
 *    时刻页面上登记在册的区块只有两个——一个是收起状态下 display:none 的空插槽
 *    （rect 全 0），一个是滚在视口外的参与者列表（top=936.9）。也就是说避让算法
 *    本身算得没错，它的输入里压根没有这个区块。每加一个新区块就得有人记得打标记，
 *    这就是同一个 bug 换个区块反复发作的机制。
 * 2. **就算登记全了，"往上抬"也救不了密集列表。** 同一份实测数据：比价行上面
 *    紧挨着的另一行 rect top=693.6 bottom=755.9。胶囊要让开下面那行得抬到
 *    707.9，正好压在上面那行身上——列表行是连续排布的，抬多少都是从挡这行变成
 *    挡那行，只是把打地鼠从"提交代码时"搬到了"用户滚动时"。
 *
 * 所以这轮不修算法也不补标记，直接换结构：**操作条占一条自己的横带，页面容器
 * 预留出同样高的底部空白**（`.action-bar` 和 `.action-bar-reserve` 共用
 * `--action-bar-h` 这一个变量，两边不可能对不上）。这样得到一条硬保证：滚到底时
 * 视口最下面那 `--action-bar-h` px 是容器的 padding，里面不可能有内容，操作条盖
 * 的永远是空白。内容不会再被一个悬浮物体斜着切掉一块，也不再有"这个区块打标记了
 * 没有"这个会漏的步骤——`data-fab-avoid`、运行时量重叠的 useEffect、防止抬过头
 * 的 HEADER_CLEARANCE 保险丝，连同它们各自的坑一起删掉了。
 *
 * 守护：`record-expense-bar.test.ts` 静态盯住这几条不变量（不许再出现
 * `data-fab-avoid`、不许再出现贴底/贴角的 fixed 元素、预留高度必须跟操作条
 * 共用同一个变量），防止以后有人把悬浮胶囊那套改回来。
 *
 * ## round72b：单一按钮改成"＋"触发的小菜单
 *
 * 借钱/还钱功能上线后这条操作条要装三个入口（记消费/借钱给同行人/记一笔还钱），
 * 不能再是一颗直接跳转的 Link。改成点"＋"弹出一个贴着 `.action-bar` 上方向上
 * 展开的小菜单——这是全新、独立的一块 UI（不是 `SelectDropdown` 那个 value/
 * onChange 单值下拉，这里是"点了直接导航"的菜单项，形状不一样），只借它同一个
 * `useDismissableOpen` hook 处理点空白/Escape 关闭，不重复手写第二份监听器
 * （见 components/select-dropdown.tsx 顶部注释，这个 hook 就是为这类场景抽出来的）。
 *
 * 只保证自己向上弹、不被这条操作条自己盖住（`bottom-full` + `mb-2`，菜单永远
 * 长在触发按钮正上方）——这跟另一个并行任务在修的"下拉遮挡"是同一类"贴底部
 * 容易被操作条盖住"的场景，但这里是全新 UI 自己控制定位，不去动
 * `select-dropdown.tsx` 那个共享组件。
 */
export function RecordExpenseBar({ tripId }: { tripId: string }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useDismissableOpen(menuOpen, () => setMenuOpen(false));
  // fix(round72b)：这个组件挂在 trip 共享布局里，切 tab/换页不会重新挂载——
  // 跟 navigation-state-reset.test.ts 第 64 轮横扫的那条规则同一类坑，路径一变
  // 就把菜单收起，不然点开菜单再点别的 tab 链接，菜单会跟着人"走"到下一页。
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const onFormPage =
    pathname.includes('/expenses/new') ||
    pathname.includes('/edit') ||
    pathname.includes('/exchange/new') ||
    pathname.includes('/loans/new') ||
    // 支付方式设置页自己的主提交按钮("添加支付方式")就在页面底部，跟这条操作条
    // 是同一类"最主要的操作入口"，两个深色按钮叠在一起容易误触，处理方式跟记消费/
    // 换汇表单一致：这页不需要"记一笔消费"这个快捷入口。
    pathname.includes('/payment-methods');

  if (onFormPage) return null;

  return (
    <div className="action-bar" data-testid="record-expense-bar">
      {/* 内层跟 app/layout.tsx 的 `mx-auto max-w-3xl px-4` 同宽，桌面宽屏上按钮跟正文右
          边缘对齐，不会横跨整个窗口。按钮本身保持原来那颗胶囊的样子和右对齐位置（只是
          字号从手写的 14px 换成全站 .btn-primary 这个 chokepoint 的 12.5px），这轮改的是
          它待的地方，不是它长什么样——要不要改成满宽主 CTA 是另一个设计决定，交 Remy 定。 */}
      <div ref={menuRef} className="relative mx-auto flex w-full max-w-3xl justify-end px-4">
        {menuOpen && (
          <div
            role="menu"
            aria-label="记一笔"
            className="absolute bottom-full right-4 mb-2 flex w-[min(220px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-sand bg-white shadow-card"
          >
            <Link
              href={`/trips/${tripId}/expenses/new`}
              role="menuitem"
              onClick={() => setMenuOpen(false)}
              className="px-3 py-2.5 text-left text-[12.5px] font-medium text-ink hover:bg-neutral-lt"
            >
              记消费
            </Link>
            <Link
              href={`/trips/${tripId}/loans/new`}
              role="menuitem"
              onClick={() => setMenuOpen(false)}
              className="border-t border-sand px-3 py-2.5 text-left text-[12.5px] font-medium text-ink hover:bg-neutral-lt"
            >
              借钱给同行人
            </Link>
            <Link
              // 还钱要先挑是哪一笔欠款，落地位置是行程主页"借还款"区块（LoanList
              // 每行自己带"记还款"按钮），不整一个只填金额、猜是哪笔的独立表单——
              // 见 loan-list.tsx 顶部注释。
              href={`/trips/${tripId}#loans`}
              role="menuitem"
              onClick={() => setMenuOpen(false)}
              className="border-t border-sand px-3 py-2.5 text-left text-[12.5px] font-medium text-ink hover:bg-neutral-lt"
            >
              记一笔还钱
            </Link>
          </div>
        )}
        {/* 2026-09-23 第三十二轮：round18 那次把圆角局部收成 rounded-xl 的例外已经
            撤销，改回全站统一的 pill（跟着 .btn-primary 这个 chokepoint 的
            rounded-full 走，不再局部覆盖圆角）。权威裁决和理由见
            DESIGN-BRIEF.md「第三十二轮：圆角/表单 spacing 权威规格钉死」小节，
            这里不重复贴大段论证，以后要改圆角先去那份文档对齐，别只看这条注释。
            fix(2026-09-18，第二十五轮，逐 token 核对 Artifact `.actionbar button`)：
            读了 Artifact V10 源码第286行确认字面规格是
            `padding:9px 14px; font-size:12px; gap:6px`——`.btn-primary` 这个全站
            chokepoint 因为"第四轮全局紧凑化"已经收到 11px/10px 全站统一值（给"添加
            支付方式"这类旁白按钮用没问题），但这颗全站最高频的主 CTA 沿用同一个值
            是没人专门核对过的漂移，不是这轮才发现"要故意缩得比方案还小"。这里跟
            圆角一样局部覆盖三个值到字面一致，触控高度 min-h-[44px]（Apple HIG
            最小热区）继续保留不收——热区是安全底线，不跟着视觉密度一起收。 */}
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="btn-primary gap-[6px] !px-[14px] !py-[9px] !text-[12px] shadow-card"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          记一笔
        </button>
      </div>
    </div>
  );
}
