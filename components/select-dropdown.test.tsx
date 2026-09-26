// @vitest-environment jsdom
/**
 * `SelectDropdown` 方案 C（2026-09-26 手机底部弹层）回归测试。
 *
 * 背景：全站底部常驻 `.action-bar`（`fixed inset-x-0 bottom-0 z-20`，见
 * `app/globals.css`）比弹层原来的 `z-10` 更高，触发按钮滚到视口下半部分时，选项多
 * 的下拉（支付方式筛选 7 选最典型）向下展开的一截会被操作条永久盖住、滚不动。
 *
 * 修法：窄屏（<640px）改成从屏幕底部滑上来的抽屉（`fixed`，`z-30` 盖过操作条，
 * `max-h-[60vh]` 封顶+内部滚动，浮在操作条上方留呼吸间距，点遮罩关闭）；宽屏
 * （`sm:` 起）维持原来"贴着触发按钮悬浮"的定位，但同样把 `z-10` 升到 `z-30`，
 * `max-h-[220px]` 继续生效。
 *
 * jsdom 测不出真实层叠渲染（"到底有没有被操作条挡住"这种视觉判断），这份测试只
 * 断言结构性事实：面板确实套了预期的 z-index/max-height class、遮罩/外部点击/
 * 选中选项都能正确关闭+触发 onChange。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SelectDropdown } from './select-dropdown';

afterEach(() => {
  cleanup();
});

const OPTIONS = [
  { value: 'cash', label: '现金' },
  { value: 'card', label: '信用卡' },
  { value: 'ewallet', label: '电子钱包' },
];

function renderDropdown(onChange = vi.fn()) {
  render(
    <SelectDropdown
      value="cash"
      onChange={onChange}
      options={OPTIONS}
      ariaLabel="按支付方式筛选"
      triggerClassName="field-input"
    />
  );
  return onChange;
}

describe('SelectDropdown 方案 C 底部弹层', () => {
  it('①展开时面板存在，且套了窄屏 60vh 封顶 + 宽屏 220px 封顶 + z-30 三个结构性 class', () => {
    renderDropdown();
    fireEvent.click(screen.getByRole('button', { name: '按支付方式筛选' }));

    // 外层遮罩：窄屏是 `fixed inset-0` 全屏遮罩（跟 record-expense-bar.test.ts
    // 那份结构守护"只放行全屏遮罩"的形状对得上），宽屏用 sm:contents 让它整个不
    // 生成盒子，抽屉退回原来"绝对定位贴着触发按钮悬浮"的独立元素。
    const overlay = screen.getByTestId('select-dropdown-overlay');
    expect(overlay.className).toContain('fixed');
    expect(overlay.className).toContain('inset-0');
    expect(overlay.className).toContain('sm:contents');

    const sheet = screen.getByTestId('select-dropdown-sheet');
    // 窄屏封顶：抽屉最高只能到视口 60% 高，超出内部滚动，不能撑出屏幕。
    expect(sheet.className).toContain('max-h-[60vh]');
    // 宽屏（sm: 起）封顶维持原有 220px，且改用悬浮定位。
    expect(sheet.className).toContain('sm:max-h-[220px]');
    expect(sheet.className).toContain('sm:absolute');
    expect(sheet.className).toContain('sm:top-full');
    // z-index 宽屏要盖过 .action-bar 的 z-20（窄屏靠遮罩本身的 z-30 层叠，不用重复）。
    expect(sheet.className).toContain('sm:z-30');
    expect(sheet.className).not.toContain('z-10');

    // 真正滚动的是内部 <ul>（面板本体用 flex 布局，把拖拽把手条钉在顶部）。
    const listbox = screen.getByRole('listbox');
    expect(listbox.className).toContain('overflow-y-auto');
  });

  it('②点遮罩关闭下拉（窄屏抽屉专用遮罩，不是"点击外部"逻辑）', () => {
    renderDropdown();
    fireEvent.click(screen.getByRole('button', { name: '按支付方式筛选' }));
    expect(screen.getByRole('listbox')).toBeTruthy();

    fireEvent.click(screen.getByTestId('select-dropdown-overlay'));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('②点击组件外部（宽屏场景，没有遮罩挡着）也能关闭下拉', () => {
    render(
      <div>
        <SelectDropdown
          value="cash"
          onChange={vi.fn()}
          options={OPTIONS}
          ariaLabel="按支付方式筛选"
          triggerClassName="field-input"
        />
        <button type="button">外部按钮</button>
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: '按支付方式筛选' }));
    expect(screen.getByRole('listbox')).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole('button', { name: '外部按钮' }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('③选中一个选项触发 onChange(选中值) 并关闭面板', () => {
    const onChange = renderDropdown();
    fireEvent.click(screen.getByRole('button', { name: '按支付方式筛选' }));

    fireEvent.mouseDown(screen.getByRole('option', { name: '信用卡' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('card');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Escape 关闭下拉（跟遮罩/外部点击是独立的第三条关闭路径）', () => {
    renderDropdown();
    fireEvent.click(screen.getByRole('button', { name: '按支付方式筛选' }));
    expect(screen.getByRole('listbox')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('调用方传的 panelClassName 只追加外观 class，不会盖掉组件本体算好的定位/z-index/max-height', () => {
    render(
      <SelectDropdown
        value="cash"
        onChange={vi.fn()}
        options={OPTIONS}
        ariaLabel="自定义外观下拉"
        triggerClassName="field-input"
        panelClassName="min-w-[110px] border border-sand bg-white p-1 shadow-card"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '自定义外观下拉' }));

    const sheet = screen.getByTestId('select-dropdown-sheet');
    expect(sheet.className).toContain('min-w-[110px]');
    expect(sheet.className).toContain('sm:z-30');
    expect(sheet.className).toContain('max-h-[60vh]');
    expect(sheet.className).toContain('sm:max-h-[220px]');
  });
});
