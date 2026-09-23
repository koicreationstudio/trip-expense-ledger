'use client';

/**
 * 全站统一的深色开关（取代浏览器原生 `<input type="checkbox">`）。
 *
 * fix(2026-09-24 第三十九轮，团队看板 id=2026-09-23_232946_2850b4c5)：这个样式
 * 之前只在 `expense-form.tsx`"跟其他人 split 这笔"那一处写过（`role="switch"` +
 * `h-[18px] w-[32px]` 胶囊 + 选中态 `bg-accent-700`/白色圆点位移），
 * `payment-methods-manager.tsx`"本行程启用的支付方式"那一批勾选框当时漏抄，
 * 还是浏览器原生 `<input type="checkbox">`（默认蓝色），跟旁边这套深色开关语言
 * 不搭。这次抽成共用组件，两处都改成调用它，不是各自留一份原地小改——避免以后
 * 再新增第三处又漏（这个项目这类"平行实现漂移"已经踩过好几次，见
 * `select-dropdown.tsx` 顶部同一批修复的说明）。
 */
export function Switch({
  checked,
  onChange,
  disabled,
  ariaLabel,
  id,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-accent-700' : 'bg-sand'
      }`}
    >
      <span
        className={`inline-block h-[14px] w-[14px] transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[16px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  );
}
