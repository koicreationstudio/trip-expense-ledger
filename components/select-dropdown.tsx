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
 * fix(2026-09-26 第七十二轮第四批，合并方案 A + 方案 C)：这个组件先后叠了两轮独立的
 * "被 `.action-bar` 盖住"修复——方案 A（打开瞬间测量触发按钮到视口底部的剩余空间，
 * 不够用就 `bottom-full` 向上开）先落地，随后又出了一份没合并的方案 C（窄屏索性改成
 * 从屏幕底部滑上来的抽屉，不再跟触发按钮的位置有关系）。Remy 拍板选方案 C（原话
 * "固定住不要超过界面的多少，如果选项太多可以用 scroll 的方式"），这次正式合并，
 * 两套逻辑不再互相打架：
 * - 窄屏（<640px，Tailwind `sm` 断点以下）：整体改用方案 C——从屏幕底部滑上来的
 *   固定抽屉（`fixed inset-x-0`，浮在 `.action-bar` 上方而不是贴着它），跟触发按钮
 *   在页面里的位置完全无关，`max-height` 固定 `60vh`（Remy 原话"不要超过界面的
 *   多少"），选项多时 `overflow-y-auto` 内部滚动。方案 A 那套"打开瞬间测量空间决定
 *   向上/向下开"的逻辑，窄屏不再套用——固定贴底抽屉不需要判断方向。
 * - 宽屏（≥640px）：保留方案 A 的智能开合方向（下面 `openUpward` 那段测量逻辑），
 *   维持"贴着触发按钮悬浮，空间不够就向上开"的桌面交互，同样有 `max-height` 上限
 *   （`260px`，round72 批次②从 220px 提高过，见下方渲染处注释）防止面板本身比
 *   视口还高。
 * - 两个断点共用同一套 `z-30`（盖过 `.action-bar` 的 `z-20`）；断点切换纯用 CSS
 *   media query（Tailwind `sm:` 前缀），不用 JS 判断 `window.innerWidth`——这个
 *   组件原本也没有既有的 JS 宽窄屏判断模式，media query 更简单也不用处理 resize。
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
  /** fix(2026-09-26 第七十二轮第四批，合并方案A+C)：这个 prop 现在只管弹层的
   * "外观"（边框/背景/圆角/内边距/阴影/宽高），不要再传 `absolute`/`fixed`/
   * `top-full`/`bottom-full`/`z-30`/`mt-1`/`mb-1` 这类定位 class——窄屏固定走
   * 方案C底部抽屉，宽屏走方案A智能开合方向，两套定位逻辑都由组件本体自动算好
   * 套在外面，调用方传的这串 class 只会拼接在定位 class 后面。 */
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

  // fix(2026-09-26 第七十二轮，round70 对照稿第⑤项方案 A)：这段"智能开合方向"
  // 测量逻辑第七十二轮第四批合并方案 C 之后只在宽屏（`sm:` 起）生效——窄屏方案 C
  // 固定走底部抽屉，不看这个方向判断（见下面渲染处 `directionClass` 只拼在
  // `sm:` 前缀上）。测量本身照样每次打开都会跑（不用另外判断当前是不是窄屏，
  // 算出来的值窄屏下单纯不会被用到，没有副作用，比额外加一层 `window.innerWidth`
  // 判断更简单）。全站底部常驻一条 `.action-bar`（`app/globals.css`，`fixed
  // inset-x-0 bottom-0 z-20`，高度 `--action-bar-h`=60px），宽屏面板之前永远
  // `top-full` 向下开——触发按钮滚到视口下半部分时，面板向下展开的这一截会落在
  // 操作条覆盖的区域里，永远看不到、滚不动（固定定位元素的天然特性，不是"没滚
  // 到"）。这里在面板打开的那一刻算一次触发按钮到视口底部的可用空间，不够用
  // （要扣掉操作条占的 60px）就改成向上开（`bottom-full`），够用维持原来向下
  // 开——只在打开瞬间判断一次，不监听 scroll/resize 做实时反悬浮（面板开着时
  // 用户很少还在滚页面，一次性判断够用，不需要过度设计）。
  const [openUpward, setOpenUpward] = useState(false);
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    // ACTION_BAR_RESERVE_PX 跟 app/globals.css 的 --action-bar-h（60px）同步，
    // 写死不读 CSS 变量——这个值本身极少变、写死更简单可靠，改的话两边一起改。
    const ACTION_BAR_RESERVE_PX = 60;
    // 面板 sm:max-h-[260px]（第七十二轮批次②从 220px 提高，见下面渲染处注释），
    // 留一点余量（可能有 min-w 换行/更多选项），阈值给够。
    const PANEL_SAFE_HEIGHT_PX = 280;
    const spaceBelow = window.innerHeight - rect.bottom - ACTION_BAR_RESERVE_PX;
    setOpenUpward(spaceBelow < PANEL_SAFE_HEIGHT_PX);
  }, [open]);
  // fix(2026-09-26 第七十二轮第四批)：方向 class 全部改成 `sm:` 前缀——只在宽屏
  // 生效，窄屏走方案 C 固定底部抽屉（见渲染处 sheet 的 base class），不受这个
  // 方向判断影响。
  const directionClass = openUpward ? 'sm:bottom-full sm:mb-1' : 'sm:top-full sm:mt-1';

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
        // fix(2026-09-26 第七十二轮第四批)：窄屏这层是"遮罩 + 抽屉"的外壳，不是又
        // 一个贴底/贴角瞎悬浮的 fixed 控件——`record-expense-bar.test.ts` 那份结构
        // 守护明确只放行 `fixed inset-0` 全屏遮罩，这里就是照这个形状搭的：外层
        // `fixed inset-0` 占满整个视口当遮罩底色，`flex flex-col justify-end` 让
        // 真正的白色抽屉自己贴着底边露出来（不用再另算一个 bottom 偏移值），点遮罩
        // 露出来的那圈空白（抽屉本身 `onClick` 里 `stopPropagation` 挡掉了）就会
        // 关闭。宽屏（`sm:` 起）用 `sm:contents` 让这层外壳整个不生成自己的盒子
        // （背景/flex 布局都随之失效），里面的抽屉退回方案 A 那套"绝对定位贴着触发
        // 按钮悬浮 + 智能开合方向"的独立元素，定位基准是往上找到的第一个
        // `position` 非 static 祖先——也就是最外层这个 `relative` 容器。
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
            // fix(2026-09-26 第七十二轮第四批，合并方案A+C)：`mb-[calc(...)]` 算的是
            // "窄屏抽屉离视口底边要留多少空白"——`--action-bar-h`（`app/globals.css`
            // 定义的底部操作条高度，60px，`:root` 全局变量，不管当前页面有没有渲染
            // `.action-bar` 这个元素都能取到）+ 安全区 + 12px 呼吸间距，让抽屉浮在
            // 操作条上方而不是贴着它，最后一个选项才不会紧贴操作条上边缘看不清分界。
            // 没有底部操作条的页面（比如邀请加入页）也一样吃这段留白，纯粹当成"离
            // 屏幕底边的安全间距"，效果只是多一点呼吸空间，不会显得空。
            //
            // 宽屏（`sm:` 起）不再固定 `sm:top-full`——改拼上面算好的 `directionClass`
            // （`sm:top-full sm:mt-1` 或 `sm:bottom-full sm:mb-1`），保留方案 A 的
            // 智能开合方向；`sm:max-h-[260px]`（round72 批次②从 220px 提高，修 8
            // 选项时第 8 项被裁掉又没有可见滚动提示这个真 bug，理由不变，这次合并
            // 沿用这个已经验证过的数值，不回退成方案 C 分支当时还是 220px 的旧值）。
            className={`flex max-h-[60vh] flex-col rounded-t-2xl border border-sand bg-white p-1 pt-2 shadow-card mb-[calc(var(--action-bar-h)+env(safe-area-inset-bottom)+12px)] sm:absolute sm:left-0 sm:z-30 sm:mb-0 sm:max-h-[260px] sm:rounded-[10px] sm:pt-1 ${directionClass} ${
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
            {/* fix(2026-09-26 第七十二轮批次②，ui-auditor 用真实香港行程抓到的真
                bug，这次合并沿用同一个修法)：滚动条本身默认在 macOS/触屏上是"滚动时
                才出现"的覆盖式滚动条，没有任何持续可见的提示——选项多到要滚动时，
                用户容易以为列表就显示的这几项。显式给 `::-webkit-scrollbar` 上色，
                至少桌面 Chrome/Safari/Edge 上有个持续可见的细条提示"这里能滚"。 */}
            <ul
              id={listboxId}
              role="listbox"
              className="min-h-0 flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-[4px] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-sand"
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
