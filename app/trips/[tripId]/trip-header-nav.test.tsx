// @vitest-environment jsdom
/**
 * 第七十一轮任务④：行程切换下拉去掉标题行（"展开：切到其它行程"/"管理行程"），
 * "＋ 新建行程"从标题行挪到列表最底部。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/trips/trip-1',
}));

import { TripHeaderNav } from './trip-header-nav';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BASE_PROPS = {
  tripId: 'trip-1',
  tripName: '🇭🇰2026香港',
  subtitle: '2026-09-15 · 3 人',
  accountHref: '/account',
  isOwner: true,
  navLinks: [
    { href: '/trips/trip-1', label: '主页' },
    { href: '/trips/trip-1/settlement', label: '结算' },
  ],
};

describe('TripHeaderNav 下拉面板', () => {
  it('展开后找不到旧的标题行文字，"＋ 新建行程"仍然存在', () => {
    render(
      <TripHeaderNav
        {...BASE_PROPS}
        otherTrips={[{ id: 'trip-2', name: '泰国行', isOwner: true } as any]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /🇭🇰2026香港/ }));

    expect(screen.queryByText('展开：切到其它行程')).toBeNull();
    expect(screen.queryByText('管理行程')).toBeNull();
    expect(screen.getByText('新建行程')).not.toBeNull();
  });

  it('"新建行程"是列表最后一项（排在当前行程 + 其它行程之后）', () => {
    render(
      <TripHeaderNav
        {...BASE_PROPS}
        otherTrips={[{ id: 'trip-2', name: '泰国行', isOwner: true } as any]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /🇭🇰2026香港/ }));

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain('🇭🇰2026香港');
    expect(items[1]?.textContent).toContain('泰国行');
    expect(items[2]?.textContent).toContain('新建行程');
  });

  it('没有其它行程时（owner，仅自己一趟）也不显示旧标题行，"新建行程"仍在列表末尾', () => {
    render(<TripHeaderNav {...BASE_PROPS} otherTrips={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /🇭🇰2026香港/ }));

    expect(screen.queryByText('管理行程')).toBeNull();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[1]?.textContent).toContain('新建行程');
  });
});
