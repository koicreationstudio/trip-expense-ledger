// @vitest-environment jsdom
/**
 * `SelectDropdown` 合并版（2026-09-26 第七十二轮第四批）回归测试——之前方案 A（智能
 * 开合方向）跟方案 C（手机底部弹层）各自出过一份独立测试文件，这次合并成同一个组件
 * 行为，测试也合并成一份，分两组：
 *
 * ①「宽屏智能开合方向」——组件本体测量触发按钮离视口底部还有多少空间，不够用
 * （扣掉 `.action-bar` 60px 之后撑不下 280px 安全高度）就改成向上开。合并后这组
 * class 全部挂在 `sm:` 前缀上（挂在 `select-dropdown-sheet` 这个 testid 元素，不再
 * 是裸的 `listbox`），断言目标跟着改，判断逻辑本身（280px 阈值等）不变。
 *
 * ②「窄屏方案 C 底部抽屉」——jsdom 测不出真实层叠渲染（"到底有没有被操作条挡住"这种
 * 视觉判断，也测不出 Tailwind `sm:` media query 实际有没有生效），这组只断言结构性
 * 事实：面板确实套了预期的 class、遮罩/外部点击/选中选项/Escape 都能正确关闭。
 *
 * fix(2026-09-26 第七十二轮第四批)：`sm:max-h-[220px]` 改成 `sm:max-h-[260px]`——
 * round72 批次②已经把这个数值从 220 提到 260（修 8 个选项时第 8 项被裁掉的真 bug），
 * 这次合并沿用这个已验证过的数值，不回退。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SelectDropdown } from './select-dropdown';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const OPTIONS = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
];

const PAYMENT_OPTIONS = [
  { value: 'cash', label: '现金' },
  { value: 'card', label: '信用卡' },
  { value: 'ewallet', label: '电子钱包' },
];

function mockViewportAndTriggerRect(innerHeight: number, triggerBottom: number) {
  vi.stubGlobal('innerHeight', innerHeight);
  vi.spyOn(HTMLButtonElement.prototype, 'getBoundingClientRect').mockReturnValue({
    bottom: triggerBottom,
    top: triggerBottom - 20,
    left: 0,
    right: 100,
    width: 100,
    height: 20,
    x: 0,
    y: triggerBottom - 20,
    toJSON: () => {},
  });
}

function renderAndOpen(panelClassName?: string) {
  render(
    <SelectDropdown
      value="a"
      onChange={() => {}}
      options={OPTIONS}
      ariaLabel="测试下拉"
      triggerClassName="field-input"
      panelClassName={panelClassName}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: '测试下拉' }));
}

function renderPaymentDropdown(onChange = vi.fn()) {
  render(
    <SelectDropdown
      value="cash"
      onChange={onChange}
      options={PAYMENT_OPTIONS}
      ariaLabel="按支付方式筛选"
      triggerClassName="field-input"
    />
  );
  return onChange;
}

describe('SelectDropdown 宽屏智能开合方向（方案 A，sm: 断点起生效）', () => {
  it('①触发按钮下方空间充足时，面板向下开（sm:top-full）', () => {
    // 视口 800px，触发按钮底部在 200px 处 → 下方剩余 600px，远超阈值。
    mockViewportAndTriggerRect(800, 200);
    renderAndOpen();
    const sheet = screen.getByTestId('select-dropdown-sheet');
    expect(sheet.className).toContain('sm:top-full');
    expect(sheet.className).not.toContain('sm:bottom-full');
  });

  it('②触发按钮靠近视口底部、下方空间不足时，面板向上开（sm:bottom-full）', () => {
    // 视口 800px，触发按钮底部在 700px 处 → 下方剩余 100px，扣掉操作条 60px 只剩
    // 40px，远小于 280px 安全高度，必须向上开。
    mockViewportAndTriggerRect(800, 700);
    renderAndOpen();
    const sheet = screen.getByTestId('select-dropdown-sheet');
    expect(sheet.className).toContain('sm:bottom-full');
    expect(sheet.className).not.toContain('sm:top-full');
  });

  it('③边界值：扣掉操作条后剩余空间刚好等于安全高度阈值，不误判成"不足"（维持向下开）', () => {
    // 视口 1000px，安全高度阈值 280px，操作条占 60px → 触发按钮底部要在
    // 1000 - 280 - 60 = 660px 处，此时 spaceBelow 恰好等于 280（不小于阈值，
    // 判断条件是 `< 280` 才算不足），维持向下开。
    mockViewportAndTriggerRect(1000, 660);
    renderAndOpen();
    const sheet = screen.getByTestId('select-dropdown-sheet');
    expect(sheet.className).toContain('sm:top-full');
    expect(sheet.className).not.toContain('sm:bottom-full');
  });

  it('调用方传的 panelClassName 只提供外观，不覆盖组件自己算出的定位 class', () => {
    mockViewportAndTriggerRect(800, 700); // 空间不足，应该向上开
    renderAndOpen('min-w-[110px] border border-sand bg-white p-1 shadow-card');
    const sheet = screen.getByTestId('select-dropdown-sheet');
    expect(sheet.className).toContain('sm:bottom-full');
    expect(sheet.className).toContain('min-w-[110px]');
  });
});

describe('SelectDropdown 窄屏方案 C 底部弹层', () => {
  it('①展开时面板存在，且套了窄屏 60vh 封顶 + 宽屏 260px 封顶 + z-30 三个结构性 class', () => {
    renderPaymentDropdown();
    fireEvent.click(screen.getByRole('button', { name: '按支付方式筛选' }));

    // 外层遮罩：窄屏是 `fixed inset-0` 全屏遮罩（跟 record-expense-bar.test.ts
    // 那份结构守护"只放行全屏遮罩"的形状对得上），宽屏用 sm:contents 让它整个不
    // 生成盒子，抽屉退回方案 A 那套"绝对定位贴着触发按钮悬浮+智能开合方向"的独立
    // 元素。
    const overlay = screen.getByTestId('select-dropdown-overlay');
    expect(overlay.className).toContain('fixed');
    expect(overlay.className).toContain('inset-0');
    expect(overlay.className).toContain('sm:contents');

    const sheet = screen.getByTestId('select-dropdown-sheet');
    // 窄屏封顶：抽屉最高只能到视口 60% 高，超出内部滚动，不能撑出屏幕。
    expect(sheet.className).toContain('max-h-[60vh]');
    // 宽屏（sm: 起）封顶用 260px（round72 批次②的修复值，这次合并沿用）。
    expect(sheet.className).toContain('sm:max-h-[260px]');
    expect(sheet.className).toContain('sm:absolute');
    // z-index 宽屏要盖过 .action-bar 的 z-20（窄屏靠遮罩本身的 z-30 层叠，不用重复）。
    expect(sheet.className).toContain('sm:z-30');
    expect(sheet.className).not.toContain('z-10');

    // 真正滚动的是内部 <ul>（面板本体用 flex 布局，把拖拽把手条钉在顶部）。
    const listbox = screen.getByRole('listbox');
    expect(listbox.className).toContain('overflow-y-auto');
  });

  it('②点遮罩关闭下拉（窄屏抽屉专用遮罩，不是"点击外部"逻辑）', () => {
    renderPaymentDropdown();
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
          options={PAYMENT_OPTIONS}
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
    const onChange = renderPaymentDropdown();
    fireEvent.click(screen.getByRole('button', { name: '按支付方式筛选' }));

    fireEvent.mouseDown(screen.getByRole('option', { name: '信用卡' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('card');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Escape 关闭下拉（跟遮罩/外部点击是独立的第三条关闭路径）', () => {
    renderPaymentDropdown();
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
        options={PAYMENT_OPTIONS}
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
    expect(sheet.className).toContain('sm:max-h-[260px]');
  });
});
