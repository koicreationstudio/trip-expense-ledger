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
  /** fix(2026-09-26 第七十二轮)：这个 prop 现在只管弹层的"外观"（边框/背景/圆角/
   * 内边距/阴影/宽高），不要再传 `absolute`/`top-full`/`bottom-full`/`z-10`/
   * `mt-1`/`mb-1` 这类定位 class——组件本体会根据触发按钮离视口底部还有多少
   * 空间自动算好开合方向+定位，统一套在外面，调用方传的这串 class 只会拼接在
   * 定位 class 后面。 */
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

  // fix(2026-09-24 第三十九轮)：点空白/Escape 关闭这段逻辑改用下面抽出来的共用 hook，
  // 不再自己单独维护一份——这个组件本体也是这个 hook 的调用方之一，不是特殊代码路径。
  const containerRef = useDismissableOpen(open, () => {
    setOpen(false);
    triggerRef.current?.focus();
  });

  // fix(2026-09-26 第七十二轮，round70 对照稿第⑤项方案 A)：全站底部常驻一条
  // `.action-bar`（`app/globals.css`，`fixed inset-x-0 bottom-0 z-20`，高度
  // `--action-bar-h`=60px），面板之前永远 `top-full` 向下开——触发按钮滚到视口
  // 下半部分时，面板向下展开的这一截会落在操作条覆盖的区域里，永远看不到、滚不动
  // （固定定位元素的天然特性，不是"没滚到"）。这里在面板打开的那一刻算一次触发
  // 按钮到视口底部的可用空间，不够用（要扣掉操作条占的 60px）就改成向上开
  // （`bottom-full`），够用维持原来向下开——只在打开瞬间判断一次，不监听
  // scroll/resize 做实时反悬浮（面板开着时用户很少还在滚页面，一次性判断够用，
  // 不需要过度设计）。
  const [openUpward, setOpenUpward] = useState(false);
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    // ACTION_BAR_RESERVE_PX 跟 app/globals.css 的 --action-bar-h（60px）同步，
    // 写死不读 CSS 变量——这个值本身极少变、写死更简单可靠，改的话两边一起改。
    const ACTION_BAR_RESERVE_PX = 60;
    // 面板 max-h-[220px]，留一点余量（可能有 min-w 换行/更多选项），阈值给够。
    const PANEL_SAFE_HEIGHT_PX = 240;
    const spaceBelow = window.innerHeight - rect.bottom - ACTION_BAR_RESERVE_PX;
    setOpenUpward(spaceBelow < PANEL_SAFE_HEIGHT_PX);
  }, [open]);
  const directionClass = openUpward ? 'bottom-full mb-1' : 'top-full mt-1';

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
        <ul
          id={listboxId}
          role="listbox"
          className={`absolute left-0 z-10 ${directionClass} ${
            panelClassName ??
            // fix(2026-09-17 第二十一轮，逐 token 核对)：Artifact `.fdrop-menu`/
            // `.cat-dropdown-list` 这类下拉弹层统一是 border-radius:10px，这里
            // 之前是 rounded-xl(12px)——这是全站共用的 SelectDropdown 组件，
            // 改这一处会同步修正全站所有用到它的下拉弹层，不用逐处改。
            'max-h-[220px] w-full min-w-[140px] overflow-y-auto rounded-[10px] border border-sand bg-white p-1 shadow-card'
          }`}
        >
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
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className={`cursor-pointer rounded-lg px-[6px] py-[5px] text-[10.5px] ${
                opt.value === value ? 'bg-[rgba(164,163,160,.14)] font-medium text-ink' : 'text-ink'
              } ${opt.disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-[rgba(164,163,160,.14)]'}`}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
