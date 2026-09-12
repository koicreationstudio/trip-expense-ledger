'use client';

import { useId, useRef, useState } from 'react';
import { useEffect } from 'react';

/**
 * 分类输入的自建下拉建议框，取代原生 `<input list=.../><datalist>`。
 *
 * 换掉的原因：iOS Safari（尤其 iOS 26）对 datalist 弹出面板有已知渲染缺陷，展开的
 * 建议面板会跟输入框重叠卡死——这大概率就是 Remy 反馈"分类 emoji 感觉没生效"的
 * 真正原因：数据本身早就带 emoji（见 lib/domain/categories.ts 的 COMMON_CATEGORIES），
 * 只是原生控件在她手机上根本渲染不出来，看起来像"没生效"。
 *
 * 行为上完整保留 datalist 原本"输入框 + 建议列表"的语义：不是强制单选下拉，用户
 * 可以打自己的分类文字直接提交，点列表里的选项只是个快捷方式，跟
 * lib/domain/categories.ts 注释里写的"不是穷举，可以手动打字"一致，不能退化成
 * select 那种必须二选一。
 *
 * 样式上组件保持中性——不内置 field-input/field-input-dark 任何一种配色，靠调用方
 * 传 inputClassName 决定输入框长什么样：expense-form.tsx 是浅色表单用 field-input，
 * quick-add-expense.tsx 是嵌在深色卡片里的行内表单用 field-input-dark，两处视觉差异
 * 大到没法用一个 variant prop 简单归纳，不如直接把 class 决定权交给调用方——组件
 * 只管交互逻辑，不管配色。下拉建议面板固定用浅色卡片样式（跟 trip-switcher.tsx 的
 * 下拉面板同一套 border-sand/bg-paper/shadow-card），不跟着输入框深浅色变：面板本来
 * 就是浮在页面最上层的独立图层，原生 datalist 弹出面板同样不管输入框主题。
 */
export function CategoryCombobox({
  id,
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
  inputClassName,
  required,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  placeholder?: string;
  /** 没有关联 <label htmlFor> 时用这个（quick-add-expense.tsx 场景） */
  ariaLabel?: string;
  inputClassName: string;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const query = value.trim().toLowerCase();
  const filtered = query ? options.filter((opt) => opt.toLowerCase().includes(query)) : options;

  // 点击组件外部关闭列表——跟 trip-switcher.tsx 的下拉面板同一套处理方式。
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function selectOption(opt: string) {
    onChange(opt);
    setOpen(false);
    setHighlightedIndex(-1);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setHighlightedIndex(filtered.length > 0 ? 0 : -1);
        return;
      }
      setHighlightedIndex((i) => (i + 1 >= filtered.length ? 0 : i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return;
      setHighlightedIndex((i) => (i <= 0 ? filtered.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      // 只有用方向键挑过某一项（highlightedIndex >= 0）才拦截 Enter 去选它；
      // 没挑过的话放行，让表单照常提交——保留"打完自定义文字直接按 Enter 送出整张
      // 表单"这条原生 datalist 也支持的路径，不能因为加了下拉就把这条路堵死。
      if (open && highlightedIndex >= 0 && filtered[highlightedIndex] !== undefined) {
        e.preventDefault();
        selectOption(filtered[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setHighlightedIndex(-1);
    }
  }

  const activeOptionId =
    open && highlightedIndex >= 0 && filtered[highlightedIndex] !== undefined
      ? `${listboxId}-option-${highlightedIndex}`
      : undefined;

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        aria-label={ariaLabel}
        required={required}
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlightedIndex(-1);
        }}
        onFocus={() => setOpen(true)}
        // onClick 也要开：选完一项后 input 还是 focus 状态（selectOption 里手动
        // focus 回去），这时候再点一下 input，浏览器不会重新触发 focus 事件
        // （没有焦点变化），只靠 onFocus 接不住"选完想再点开"这个操作。
        onClick={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={inputClassName}
      />
      {open && filtered.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 top-full z-10 mt-1 max-h-56 w-full min-w-[160px] overflow-y-auto rounded-xl border border-sand bg-paper shadow-card"
        >
          {filtered.map((opt, idx) => (
            <li
              key={opt}
              id={`${listboxId}-option-${idx}`}
              role="option"
              aria-selected={idx === highlightedIndex}
              // mousedown（不是 click）+ preventDefault：抢在 input 的 blur 前面选中，
              // 不然 blur 先关掉列表，这次点击就落空了——trip-switcher.tsx 处理
              // "点击外部关闭"用的是同一类时序，这里是它的镜像问题。
              onMouseDown={(e) => {
                e.preventDefault();
                selectOption(opt);
              }}
              onMouseEnter={() => setHighlightedIndex(idx)}
              className={`cursor-pointer px-[9px] py-[5px] text-[12.5px] text-ink ${
                idx === highlightedIndex ? 'bg-[rgba(164,163,160,.14)]' : ''
              } ${idx > 0 ? 'border-t border-sand' : ''}`}
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
