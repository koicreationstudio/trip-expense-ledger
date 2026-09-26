'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface SelectDropdownOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

/**
 * fix(2026-09-24 第三十九轮)：「点空白/按 Escape 关不掉」这个毛病这个项目已经反复出现
 * 过（round38 团队看板记录的 trip-header-nav.tsx/fx-compare-card.tsx 两处，本身也是
 * 这个组件最早取代掉的一批手搓下拉里漏网的两个）——根因始终是同一个：每处下拉各自
 * `useState` 一个 `open` 开关，只写了"点触发按钮切换"，没人记得再补一段
 * `mousedown`/`keydown` 监听器。这个组件从一开始就有这段逻辑（见下面），但只有真的
 * 调 `<SelectDropdown>` 组件本体的地方才享受得到——手搓面板不调用组件、只是照抄一段
 * 视觉样式的地方，不会自动继承这段行为，还是得自己重新接。
 *
 * 抽成这个独立 hook，给两类地方共用同一个实现（不是两份抄写）：
 * 1. `SelectDropdown` 组件本体自己（下面）——改成调用这个 hook，不再自己重复一份。
 * 2. 单选值下拉套不进去的场景（下拉里是多选 checkbox 面板、或者是像
 *    trip-header-nav.tsx"切换行程"那种整块管理面板，不是"选一个 value 触发
 *    onChange"这种形状）——这些地方结构上没法直接换成 `<SelectDropdown>`（value/
 *    onChange 单值模型硬套上去要么削足适履要么要素齐全度不够），但"点空白/Escape
 *    关闭"这个行为本身是完全通用的，用这个 hook 就不用再手写第二份 `mousedown`/
 *    `keydown` 监听器。
 */
export function useDismissableOpen(open: boolean, onClose: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return containerRef;
}

/**
 * 全站统一的自定义单选下拉，取代原生 `<select>`。
 *
 * 背景（第十九轮独立 ui-auditor 盲测坐实的全站系统性问题）：quick-add-expense.tsx
 * 早先为了修一处币种下拉已经写过一份局部的 `DarkChipDropdown`（白底弹层选项列表 +
 * 触发按钮由调用方决定深浅色），第二十轮把这个组件抽成全站共享版本，套到全部还在用
 * 原生 select 的地方（wallet-grid / expense-form / payment-methods-manager /
 * new-trip-form / exchange-form / expense-list / claim-form），不再各写各的。
 *
 * 设计取舍：
 * - 触发按钮完全不内置配色——跟 CategoryCombobox 同样的做法，配色决定权交给调用方的
 *   `triggerClassName`（浅色表单传 `field-input`、深色卡片传 `field-input-dark`、
 *   expense-list.tsx 那种胶囊筛选器传自己那套 `rounded-full border-sand` 样式）。
 * - 弹层选项列表固定白底浅色（`panelClassName` 可覆盖，默认对齐 Artifact
 *   `.cat-dropdown-list`/`.dd-fake` 那套白底圆角描边阴影规格），弹层本来就浮在页面
 *   最上层的独立图层，不用跟着触发按钮深浅色变——这点延续 CategoryCombobox 的说明。
 * - `<button>` 是 HTML labelable element，`<label htmlFor="xxx">` 指向这个按钮的 id
 *   点击一样会聚焦/触发它，原本 `<label htmlFor><select id></select></label>` 那套
 *   写法原样保留可用，不用额外接 aria-labelledby。
 * - Esc 关闭 + 点击外部关闭 + 点选项后把焦点还给触发按钮，跟原生 select 键盘习惯尽量
 *   接近（原生 select 还支持方向键滚动选项/输入字母跳转，这个自定义版本这次没做到
 *   那么完整，只做了"打开关闭+鼠标点选"这个最基本的可用性，够这个项目当前的表单
 *   规模用；以后真的需要更完整键盘导航再加）。
 *
 * fix(2026-09-26，方案 C 手机底部弹层)：窄屏（<640px，Tailwind `sm` 断点以下）弹层
 * 之前也是贴着触发按钮 `absolute top-full` 悬浮展开，跟桌面同一套定位——问题是全站
 * 底部常驻一条 `.action-bar`（`fixed inset-x-0 bottom-0 z-20`，不透明），比弹层
 * `z-10` 更高，触发按钮滚到视口下半部分时，悬浮面板落进操作条底下的选项会被永久盖住
 * 且滚不动（固定定位元素的天然特性，不是"没滚到"，选项多的下拉——比如支付方式筛选
 * 7 选——最容易撞上）。
 *
 * 改法：窄屏改成从屏幕底部滑上来的抽屉（`fixed inset-x-0`，浮在 `.action-bar` 上方
 * 而不是贴着它，避免最后一个选项紧贴操作条上边缘看不清分界），宽屏维持原来"贴着
 * 触发按钮悬浮"的桌面交互不变。两个断点共用同一套 `z-30`（盖过 `.action-bar` 的
 * `z-20`）和 `max-height`（窄屏 `60vh`、宽屏原有的 `220px` 继续生效），断点切换纯
 * 用 CSS media query（Tailwind `sm:` 前缀），不用 JS 判断 `window.innerWidth`——
 * 这个组件原本也没有既有的 JS 宽窄屏判断模式，media query 更简单也不用处理 resize。
 *
 * `panelClassName` 收窄成只管弹层外观（边框/背景/阴影/宽高下限），定位/z-index/
 * 圆角/max-height 这几项两个断点分别有各自固定值，统一由组件本体算好套在外面，
 * 调用方传的这串 class 只会拼接在后面（跟 fx-compare-card.tsx 那两处同步收窄）。
 */
export function SelectDropdown({
  id,
  value,
  onChange,
  options,
  ariaLabel,
  triggerClassName,
  panelClassName,
  placeholder,
  disabled,
  renderValue,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectDropdownOption[];
  /** 没有关联 <label htmlFor> 时用这个（expense-list.tsx 筛选器场景）。 */
  ariaLabel?: string;
  triggerClassName: string;
  panelClassName?: string;
  /** 当前值在 options 里找不到匹配项时的兜底显示文字。 */
  placeholder?: string;
  disabled?: boolean;
  /** 触发按钮里怎么显示当前选中项，默认直接显示 option.label；wallet-grid.tsx
   * 「绑定支付方式」这种选项文字很长（"记账选「XX」时自动扣这个钱包"）时，调用方
   * 可以传这个自定义一份更短的按钮文字，弹层列表里仍然显示完整 label。 */
  renderValue?: (selected: SelectDropdownOption | undefined) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selected = options.find((o) => o.value === value);

  // fix(2026-09-26)：关闭 + 把焦点还给触发按钮，这个动作现在有三个入口（点空白/
  // Escape 走下面的 useDismissableOpen、选中选项、窄屏点遮罩），抽成一个函数，
  // 不三份分别写 setOpen(false)+focus()。
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  // fix(2026-09-24 第三十九轮)：点空白/Escape 关闭这段逻辑改用下面抽出来的共用 hook，
  // 不再自己单独维护一份——这个组件本体也是这个 hook 的调用方之一，不是特殊代码路径。
  const containerRef = useDismissableOpen(open, close);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        id={id}
        onClick={() => !disabled && setOpen((v) => !v)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={disabled}
        className={`flex items-center justify-between gap-1 text-left disabled:cursor-not-allowed disabled:opacity-50 ${triggerClassName}`}
      >
        <span className="truncate">
          {renderValue ? renderValue(selected) : (selected?.label ?? placeholder ?? value)}
        </span>
        <span aria-hidden="true" className="shrink-0 text-[8px] opacity-50">
          ▾
        </span>
      </button>
      {open && (
        // fix(2026-09-26)：窄屏这层是"遮罩 + 抽屉"的外壳，不是又一个贴底/贴角瞎悬浮的
        // fixed 控件——`record-expense-bar.test.ts` 那份结构守护明确只放行 `fixed
        // inset-0` 全屏遮罩，这里就是照这个形状搭的：外层 `fixed inset-0` 占满整个
        // 视口当遮罩底色，`flex flex-col justify-end` 让真正的白色抽屉自己贴着底边
        // 露出来（不用再另算一个 bottom 偏移值），点遮罩露出来的那圈空白（抽屉本身
        // `onClick` 里 `stopPropagation` 挡掉了）就会关闭。宽屏（`sm:` 起）用
        // `sm:contents` 让这层外壳整个不生成自己的盒子（背景/flex 布局都随之失效），
        // 里面的抽屉退回原来"绝对定位贴着触发按钮悬浮"的独立元素，定位基准是往上找到
        // 的第一个 `position` 非 static 祖先——也就是最外层这个 `relative` 容器，跟
        // 改动前完全一致。
        // fix(2026-09-26)：这层不能加 `aria-hidden`——它现在是真正的内容容器（弹层
        // listbox 挂在它下面），标了 aria-hidden 会把整个下拉从可访问性树里连根拔掉
        // （辅助技术/role query 都找不到 listbox 了，之前手滑加过一次，被这份测试
        // 自己的 getByRole('listbox') 当场测出来）。真正装饰性、需要 aria-hidden 的
        // 是下面那条拖拽把手条，那个不含内容，标了没问题。
        <div
          data-testid="select-dropdown-overlay"
          onClick={close}
          className="fixed inset-0 z-30 flex flex-col justify-end bg-[rgba(55,55,54,.32)] sm:contents"
        >
          <div
            data-testid="select-dropdown-sheet"
            onClick={(e) => e.stopPropagation()}
            // fix(2026-09-26)：`mb-[calc(...)]` 算的是"窄屏抽屉离视口底边要留多少空
            // 白"——`--action-bar-h`（`app/globals.css` 定义的底部操作条高度，60px，
            // `:root` 全局变量，不管当前页面有没有渲染 `.action-bar` 这个元素都能取
            // 到）+ 安全区 + 12px 呼吸间距，让抽屉浮在操作条上方而不是贴着它，最后一个
            // 选项才不会紧贴操作条上边缘看不清分界。没有底部操作条的页面（比如邀请加入
            // 页）也一样吃这段留白，纯粹当成"离屏幕底边的安全间距"，效果只是多一点呼吸
            // 空间，不会显得空。宽屏用 `sm:mb-0 sm:mt-1` 换回原来贴着触发按钮的间距。
            className={`flex max-h-[60vh] flex-col rounded-t-2xl border border-sand bg-white p-1 pt-2 shadow-card mb-[calc(var(--action-bar-h)+env(safe-area-inset-bottom)+12px)] sm:absolute sm:left-0 sm:top-full sm:z-30 sm:mb-0 sm:mt-1 sm:max-h-[220px] sm:rounded-[10px] sm:pt-1 ${
              panelClassName ??
              // fix(2026-09-17 第二十一轮，逐 token 核对)：Artifact `.fdrop-menu`/
              // `.cat-dropdown-list` 这类下拉弹层统一是 border-radius:10px（这个圆角
              // 现在跟其它定位/尺寸值一样由组件本体固定算好，见上面 className 里的
              // `rounded-t-2xl sm:rounded-[10px]`，panelClassName 不用再传圆角）。
              'w-full min-w-[140px]'
            }`}
          >
            {/* 拖拽把手条——纯装饰，不接手势关闭（点遮罩/选项/Escape 已经够用）。
                只在窄屏抽屉形态显示，宽屏悬浮面板不需要。 */}
            <div aria-hidden="true" className="mx-auto mb-1 h-1 w-10 shrink-0 rounded-full bg-sand sm:hidden" />
            <ul id={listboxId} role="listbox" className="min-h-0 flex-1 overflow-y-auto">
              {options.map((opt) => (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={opt.value === value}
                  aria-disabled={opt.disabled}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (opt.disabled) return;
                    onChange(opt.value);
                    close();
                  }}
                  className={`cursor-pointer rounded-lg px-[6px] py-[5px] text-[10.5px] ${
                    opt.value === value ? 'bg-[rgba(164,163,160,.14)] font-medium text-ink' : 'text-ink'
                  } ${opt.disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-[rgba(164,163,160,.14)]'}`}
                >
                  {opt.label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
