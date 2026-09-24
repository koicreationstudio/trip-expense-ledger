// @vitest-environment jsdom
/**
 * round66 新增：这个项目第一个组件级测试。锁住"汇率比价卡零交互也 PUT
 * fx_compare_preference"这个 bug 的两个关键场景（PENDING-DECISIONS 第六十六轮）：
 *
 * ①挂载 → 载入已存档偏好 → 触发"新卡默认勾选"这类默认补全逻辑之后，必须 0 次 PUT。
 * ②用户真实操作（这里用"切目标币种下拉"代表）之后，必须恰好 1 次 PUT（不多不少）。
 *
 * 只测这两条边界，不是把整个组件的所有交互都测一遍——这个文件是"锁住这一类 bug
 * 不再复发"的回归测试，不是完整的组件测试覆盖率任务。
 *
 * 为什么不能只用 `lib/domain/fx-compare-preference-diff.test.ts` 那种纯函数测试
 * 覆盖：round66 实测坐实的根因是 React 副作用（effect）执行顺序/时序问题，这类
 * bug 结构上只有真的挂载组件、走一遍真实的 effect 调度才测得出来，提炼成纯函数
 * 测的只是"内容比对"这一层双保险，测不到"要不要发起 PUT 这个决定本身"那一层。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FxCompareCard } from './fx-compare-card';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TRIP_ID = 'trip-round66-test';
const PAYMENT_METHOD_ID = 'pm-round66-test';

/**
 * 已存档偏好里故意不包含这张卡的 key——模拟"存档之后才新增的卡"，这样
 * `loadCardRecommendations` 里"新卡默认勾选"那段派生计算一定会被真的触发一次
 * （不然测不出这段逻辑本身有没有被拦住），用来确认即使这段逻辑真的改了
 * `enabledCompareKeys`，也不会顺着导致一次 PUT。
 */
const SAVED_PREFERENCE = {
  holdCurrency: 'MYR',
  targetCurrency: 'THB',
  enabledCompareKeys: ['channel:wise', 'channel:tng', 'channel:atm', 'channel:moneychanger', 'channel:alipay'],
  amountYuan: 1000,
};

function mockFetch(putSpy: (url: string, body: string) => void) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.includes('/fx-compare-preference') && method === 'GET') {
      return new Response(JSON.stringify({ preference: SAVED_PREFERENCE }), { status: 200 });
    }
    if (url.includes('/fx-compare-preference') && method === 'PUT') {
      putSpy(url, String(init?.body ?? ''));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url.includes('/fx-mid-rates')) {
      // 故意失败，逼组件走离线兜底表——不需要真的模拟一份实时汇率也能测这个 bug。
      return new Response('fail', { status: 500 });
    }
    if (url.includes('/fx-recommendation') && method === 'POST') {
      return new Response(
        JSON.stringify({
          recommendations: [
            {
              paymentMethodId: PAYMENT_METHOD_ID,
              label: 'DIAG测试卡',
              kind: 'card',
              costInCompareCurrency: 100000,
              unavailable: false,
              requiresConversion: true,
              cashMarkupEstimated: false,
            },
          ],
        }),
        { status: 200 }
      );
    }
    throw new Error(`未预期的请求：${method} ${url}`);
  });
}

describe('FxCompareCard — round66 零交互不写 D1', () => {
  it('挂载→载入存档→新卡默认勾选之后，0 次 PUT', async () => {
    const putSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(putSpy));

    render(
      <FxCompareCard tripId={TRIP_ID} baseCurrency="MYR" hasPaymentMethods={true} enabledCurrencies={['MYR', 'THB']} />
    );

    // 等新卡默认勾选那段派生逻辑真的跑完（能在页面上看到卡片名字就代表
    // loadCardRecommendations 已经 resolve 并且 setEnabledCompareKeys 已经跑过）。
    await waitFor(() => expect(screen.getByText('DIAG测试卡')).toBeTruthy());

    // 保存 effect 有 600ms debounce，等够 1 秒确保就算有多余的写入也来得及发出。
    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(putSpy).not.toHaveBeenCalled();
  });

  it('用户真实切换目标币种之后，恰好 1 次 PUT', async () => {
    const putSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(putSpy));

    render(
      <FxCompareCard tripId={TRIP_ID} baseCurrency="MYR" hasPaymentMethods={true} enabledCurrencies={['MYR', 'THB']} />
    );

    await waitFor(() => expect(screen.getByText('DIAG测试卡')).toBeTruthy());
    // 挂载阶段本身不该有写入（跟上面那条断言同一件事，这里顺带确认一次基线）。
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(putSpy).not.toHaveBeenCalled();

    // 真实用户操作：点开"目标币种"下拉，选一个不同的值。
    fireEvent.click(screen.getByRole('button', { name: '目标币种' }));
    const options = screen.getAllByRole('option');
    const currentOption = options.find((o) => o.getAttribute('aria-selected') === 'true');
    const otherOption = options.find((o) => o !== currentOption);
    if (!otherOption) throw new Error('目标币种下拉候选不够，测试前提不成立');
    fireEvent.mouseDown(otherOption);

    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1), { timeout: 2000 });

    // 再多等一段时间，确认没有第二次补写（比如 debounce 计时器被重复触发）。
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(putSpy).toHaveBeenCalledTimes(1);

    const firstCall = putSpy.mock.calls[0];
    if (!firstCall) throw new Error('putSpy 没有被调用过');
    const [, body] = firstCall;
    const parsed = JSON.parse(body);
    expect(parsed.holdCurrency).toBe('MYR');
    expect(typeof parsed.targetCurrency).toBe('string');
    expect(parsed.targetCurrency).not.toBe('THB'); // 确实换成了别的目标币种
  });
});

describe('FxCompareCard — round66 bug G：基准换算卡片网格不拉伸', () => {
  it('4 张基准卡（MYR/USD/HKD/CNY 全部有离线兜底汇率）用 grid-cols，不再是 flex-1 拉伸写法', async () => {
    const putSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(putSpy));

    const { container } = render(
      <FxCompareCard tripId={TRIP_ID} baseCurrency="MYR" hasPaymentMethods={true} enabledCurrencies={['MYR', 'THB']} />
    );

    await waitFor(() => expect(screen.getByText('DIAG测试卡')).toBeTruthy());

    const grid = container.querySelector('[data-testid="quick-base-grid"]');
    if (!grid) throw new Error('没找到基准换算卡片网格容器');

    // 离线兜底表（FX_RATES_FALLBACK）对 MYR/USD/HKD/CNY 四个基准都查得到目标币种
    // THB 的汇率，四张卡都会渲染——这是 bug G 真实发生的场景（Remy 截图报的"4 张
    // 最后一张单独占满一整行"）。
    expect(grid.children.length).toBe(4);
    // 回归锁点：容器必须用 grid-cols 系列，不能再是旧的 flex-wrap + flex-1（那
    // 正是最后一张被拉伸撑满整行的根因）。
    expect(grid.className).toContain('grid-cols-2');
    expect(grid.className).toContain('sm:grid-cols-4');
    expect(grid.className).not.toContain('flex-wrap');
    // 每张卡片本身不再带 flex-1（会撑满 grid 分配到的那一格，等同又变相拉伸）。
    for (const card of Array.from(grid.children)) {
      expect((card as HTMLElement).className).not.toContain('flex-1');
    }
  });
});
