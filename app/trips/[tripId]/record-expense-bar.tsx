'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus } from 'lucide-react';

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
 */
export function RecordExpenseBar({ tripId }: { tripId: string }) {
  const pathname = usePathname();
  const onFormPage =
    pathname.includes('/expenses/new') ||
    pathname.includes('/edit') ||
    pathname.includes('/exchange/new') ||
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
      <div className="mx-auto flex w-full max-w-3xl justify-end px-4">
        {/* 2026-09-13：Remy 反馈按钮在满宽操作条里看着像"浮起来的胶囊"，圆角从全
            pill 收成 rounded-xl + 加阴影，让它读起来像嵌在操作条里的实心按钮，
            不是贴在空白处的气泡。只覆盖这一个位置（!important 局部覆盖），
            不动 .btn-primary 这个全站共用 chokepoint，其它按钮维持原样。 */}
        <Link href={`/trips/${tripId}/expenses/new`} className="btn-primary gap-2 !rounded-xl shadow-card">
          <Plus className="h-4 w-4" aria-hidden="true" />
          记一笔消费
        </Link>
      </div>
    </div>
  );
}
