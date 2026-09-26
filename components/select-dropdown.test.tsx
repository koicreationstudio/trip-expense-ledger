// @vitest-environment jsdom
/**
 * round72 新增：`SelectDropdown` 弹层智能开合方向的回归测试（round70 对照稿第⑤项，
 * 方案 A）。根因见组件本体注释——全站底部常驻 `.action-bar`（60px，z-20）挡住了
 * 无条件向下开（`top-full`）的弹层，触发按钮离视口底部太近时要改成向上开
 * （`bottom-full`）。
 *
 * 覆盖三个场景：①下方空间充足→维持向下开 ②下方空间不足（扣掉操作条 60px 之后
 * 撑不下 240px 安全高度）→改成向上开 ③边界值（刚好等于阈值）不误判成"不足"。
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

function renderAndOpen() {
  render(
    <SelectDropdown
      value="a"
      onChange={() => {}}
      options={OPTIONS}
      ariaLabel="测试下拉"
      triggerClassName="field-input"
    />
  );
  fireEvent.click(screen.getByRole('button', { name: '测试下拉' }));
}

describe('SelectDropdown 弹层开合方向', () => {
  it('①触发按钮下方空间充足时，面板向下开（top-full）', () => {
    // 视口 800px，触发按钮底部在 200px 处 → 下方剩余 600px，远超阈值。
    mockViewportAndTriggerRect(800, 200);
    renderAndOpen();
    const panel = screen.getByRole('listbox');
    expect(panel.className).toContain('top-full');
    expect(panel.className).not.toContain('bottom-full');
  });

  it('②触发按钮靠近视口底部、下方空间不足时，面板向上开（bottom-full）', () => {
    // 视口 800px，触发按钮底部在 700px 处 → 下方剩余 100px，扣掉操作条 60px 只剩
    // 40px，远小于 240px 安全高度，必须向上开。
    mockViewportAndTriggerRect(800, 700);
    renderAndOpen();
    const panel = screen.getByRole('listbox');
    expect(panel.className).toContain('bottom-full');
    expect(panel.className).not.toContain('top-full');
  });

  it('③边界值：扣掉操作条后剩余空间刚好等于安全高度阈值，不误判成"不足"（维持向下开）', () => {
    // 视口 1000px，安全高度阈值 240px，操作条占 60px → 触发按钮底部要在
    // 1000 - 240 - 60 = 700px 处，此时 spaceBelow 恰好等于 240（不小于阈值，
    // 判断条件是 `< 240` 才算不足），维持向下开。
    mockViewportAndTriggerRect(1000, 700);
    renderAndOpen();
    const panel = screen.getByRole('listbox');
    expect(panel.className).toContain('top-full');
    expect(panel.className).not.toContain('bottom-full');
  });

  it('调用方传的 panelClassName 只提供外观，不覆盖组件自己算出的定位 class', () => {
    mockViewportAndTriggerRect(800, 700); // 空间不足，应该向上开
    render(
      <SelectDropdown
        value="a"
        onChange={() => {}}
        options={OPTIONS}
        ariaLabel="自定义外观下拉"
        triggerClassName="field-input"
        panelClassName="min-w-[110px] rounded-[10px] border border-sand bg-white p-1 shadow-card"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '自定义外观下拉' }));
    const panel = screen.getByRole('listbox');
    expect(panel.className).toContain('bottom-full');
    expect(panel.className).toContain('min-w-[110px]');
  });
});
