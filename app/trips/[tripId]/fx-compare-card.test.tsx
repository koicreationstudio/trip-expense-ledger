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

function mockFetch(
  putSpy: (url: string, body: string) => void,
  preference: unknown = SAVED_PREFERENCE,
  // fix(2026-09-26 第七十一轮，任务③)：`settlementCurrency` 是这轮新加的字段——
  // fx-compare-card.tsx 现在拿它跟"我持有"比对来决定要不要列出这张卡。默认给
  // 'MYR'，配 SAVED_PREFERENCE 默认 holdCurrency='MYR'，让这份 mock 在"round66/
  // round67/round68 那批既有测试"里维持原来的行为（能看到 DIAG测试卡），需要
  // 测"结算币种不匹配"场景的用例自己传别的值覆盖。
  cardSettlementCurrency = 'MYR'
) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.includes('/fx-compare-preference') && method === 'GET') {
      return new Response(JSON.stringify({ preference }), { status: 200 });
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
              settlementCurrency: cardSettlementCurrency,
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

describe('FxCompareCard — 第六十七轮任务 H：兑换金额输入框千分位', () => {
  it('展示值带千分位，但派生出来的 amount 数值不受影响（挂载后默认值 1000 显示成 1,000）', async () => {
    const putSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(putSpy));

    render(
      <FxCompareCard tripId={TRIP_ID} baseCurrency="MYR" hasPaymentMethods={true} enabledCurrencies={['MYR', 'THB']} />
    );

    await waitFor(() => expect(screen.getByText('DIAG测试卡')).toBeTruthy());

    const input = screen.getByLabelText(/兑换金额/) as HTMLInputElement;
    // 存档 amountYuan=1000，展示层应该带千分位逗号，不是裸数字 "1000"。
    expect(input.value).toBe('1,000');
    expect(input.type).toBe('text');
  });

  it('打字输入会即时格式化成千分位，state 本身仍是不带逗号的纯数字', async () => {
    const putSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(putSpy));

    render(
      <FxCompareCard tripId={TRIP_ID} baseCurrency="MYR" hasPaymentMethods={true} enabledCurrencies={['MYR', 'THB']} />
    );
    await waitFor(() => expect(screen.getByText('DIAG测试卡')).toBeTruthy());

    const input = screen.getByLabelText(/兑换金额/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12500', selectionStart: 5 } });
    expect(input.value).toBe('12,500');
  });

  it('粘贴带逗号的数字（比如 "12,500"）会被正确剥逗号识别，不会变成 NaN', async () => {
    const putSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(putSpy));

    render(
      <FxCompareCard tripId={TRIP_ID} baseCurrency="MYR" hasPaymentMethods={true} enabledCurrencies={['MYR', 'THB']} />
    );
    await waitFor(() => expect(screen.getByText('DIAG测试卡')).toBeTruthy());

    const input = screen.getByLabelText(/兑换金额/) as HTMLInputElement;
    // 模拟"粘贴"：浏览器粘贴事件之后 input.value 会直接变成粘贴内容（这里带逗号），
    // 走的还是同一个 onChange，不需要额外写 onPaste。
    fireEvent.change(input, { target: { value: '12,500', selectionStart: 6 } });
    // 展示值应该正确重新格式化（不是原样带着粘贴来的逗号，也不是变成两个逗号）。
    expect(input.value).toBe('12,500');

    // 折算成目标币种的数字应该是用 12500 算出来的，不是 NaN——用「我持有」基准卡
    // 那一排（不受这个 input 影响，用来间接确认组件整体没有因为 NaN 崩掉）加上
    // 列表里数字确实是有限数字来把关。
    const amountInTargetTexts = screen.queryAllByText(/฿/);
    for (const el of amountInTargetTexts) {
      expect(el.textContent).not.toMatch(/NaN/);
    }
  });

  it('清空输入框，值变成空字符串展示（派生 amount 按现状降到 0，不引入新行为）', async () => {
    const putSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(putSpy));

    render(
      <FxCompareCard tripId={TRIP_ID} baseCurrency="MYR" hasPaymentMethods={true} enabledCurrencies={['MYR', 'THB']} />
    );
    await waitFor(() => expect(screen.getByText('DIAG测试卡')).toBeTruthy());

    const input = screen.getByLabelText(/兑换金额/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '', selectionStart: 0 } });
    expect(input.value).toBe('');
  });

  it('输入小数（"1234.5"）正确显示成 "1,234.5"，小数点后不会被塞进逗号', async () => {
    const putSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(putSpy));

    render(
      <FxCompareCard tripId={TRIP_ID} baseCurrency="MYR" hasPaymentMethods={true} enabledCurrencies={['MYR', 'THB']} />
    );
    await waitFor(() => expect(screen.getByText('DIAG测试卡')).toBeTruthy());

    const input = screen.getByLabelText(/兑换金额/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1234.5', selectionStart: 6 } });
    expect(input.value).toBe('1,234.5');
  });

  it('非法字符（字母/负号/第二个小数点）被静默拒绝，值不变，不算用户交互', async () => {
    const putSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(putSpy));

    render(
      <FxCompareCard tripId={TRIP_ID} baseCurrency="MYR" hasPaymentMethods={true} enabledCurrencies={['MYR', 'THB']} />
    );
    await waitFor(() => expect(screen.getByText('DIAG测试卡')).toBeTruthy());

    const input = screen.getByLabelText(/兑换金额/) as HTMLInputElement;
    expect(input.value).toBe('1,000');
    fireEvent.change(input, { target: { value: '1,000a', selectionStart: 6 } });
    // 非法输入直接当没发生过，展示值应该保持原样。
    expect(input.value).toBe('1,000');

    // 非法输入不算"用户交互"，不应该触发 D1 PUT。
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('挂载→载入存档这条路径不会给输入框设置光标（不 focus，不触发重定位副作用报错）', async () => {
    const putSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(putSpy));

    // 这条测试本身只要渲染+等待不抛错就代表"恢复存档路径没有意外碰光标定位逻辑"
    // （`setSelectionRange` 在没有 focus 的 input 上调用在某些浏览器环境会有副作用/
    // 警告，这里用"渲染成功且展示值正确"作为验证）。
    render(
      <FxCompareCard tripId={TRIP_ID} baseCurrency="MYR" hasPaymentMethods={true} enabledCurrencies={['MYR', 'THB']} />
    );
    await waitFor(() => expect(screen.getByText('DIAG测试卡')).toBeTruthy());
    const input = screen.getByLabelText(/兑换金额/) as HTMLInputElement;
    expect(input.value).toBe('1,000');
  });
});

describe('FxCompareCard — 第六十八轮任务 K：可比支付方式 0 行时渠道参考价自动展开', () => {
  it('情况①这趟行程根本没配置任何支付方式（hasPaymentMethods=false）——挂载即看到渠道参考价，不用点，且 0 次 PUT', async () => {
    const putSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(putSpy, SAVED_PREFERENCE));

    render(
      <FxCompareCard tripId={TRIP_ID} baseCurrency="MYR" hasPaymentMethods={false} enabledCurrencies={['MYR', 'THB']} />
    );

    // hasPaymentMethods=false 时组件根本不会去拉"我的支付方式"推荐（showCards
    // 恒 false），不能再拿 "DIAG测试卡" 当挂载完成信号，改等一个渠道行的文案。
    await waitFor(() => expect(screen.getByText('Wise')).toBeTruthy());

    // 不需要点"看换汇渠道参考价"——这颗按钮在这个场景下应该干脆不渲染（点了
    // 也不会有任何变化，属于死按钮，不如不显示）。
    expect(screen.queryByText(/看换汇渠道参考价/)).toBeNull();
    expect(screen.queryByText(/收起换汇渠道参考价/)).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('情况②「我持有」的币种不是行程本位币（持有 USD，本位币 MYR）且没有一张卡结算币种是 USD——挂载即看到渠道参考价，且 0 次 PUT（第七十一轮起：这条不再是因为"hold≠base 一律不给看卡"，是因为这张 mock 卡结算币种是 MYR，跟持有的 USD 对不上，见下面新增的"结算币种匹配"用例验证 hold≠base 时也能看到卡）', async () => {
    const putSpy = vi.fn();
    const preferenceHoldNotBase = {
      holdCurrency: 'USD',
      targetCurrency: 'THB',
      enabledCompareKeys: ['channel:wise', 'channel:tng', 'channel:atm', 'channel:moneychanger', 'channel:alipay'],
      amountYuan: 1000,
    };
    // 故意保持默认 cardSettlementCurrency='MYR'——这张卡结算币种跟"我持有 USD"对
    // 不上，cardGroupRows 应该还是 0 行，这个断言在第七十一轮改动前后都成立。
    vi.stubGlobal('fetch', mockFetch(putSpy, preferenceHoldNotBase));

    render(
      <FxCompareCard tripId={TRIP_ID} baseCurrency="MYR" hasPaymentMethods={true} enabledCurrencies={['MYR', 'THB', 'USD']} />
    );

    await waitFor(() => expect(screen.getByText('Wise')).toBeTruthy());
    // 「我持有」应该已经从存档恢复成 USD（跟本位币 MYR 不同），这是这个场景成立的前提。
    expect(screen.getByText('💰 我持有 USD')).toBeTruthy();

    expect(screen.queryByText(/看换汇渠道参考价/)).toBeNull();
    expect(screen.queryByText(/收起换汇渠道参考价/)).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('对照组：有可比支付方式（行数 > 0）时维持默认收起，需要点一下才展开', async () => {
    const putSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(putSpy, SAVED_PREFERENCE));

    render(
      <FxCompareCard tripId={TRIP_ID} baseCurrency="MYR" hasPaymentMethods={true} enabledCurrencies={['MYR', 'THB']} />
    );

    await waitFor(() => expect(screen.getByText('DIAG测试卡')).toBeTruthy());

    // 默认收起：看得到"看换汇渠道参考价 ▾"按钮，但渠道行（比如 "Wise"）还不可见。
    expect(screen.getByText('看换汇渠道参考价 ▾')).toBeTruthy();
    expect(screen.queryByText('Wise')).toBeNull();

    fireEvent.click(screen.getByText('看换汇渠道参考价 ▾'));
    await waitFor(() => expect(screen.getByText('Wise')).toBeTruthy());
    expect(screen.getByText('收起换汇渠道参考价 ▲')).toBeTruthy();
  });
});

describe('FxCompareCard — 第七十一轮任务③：我持有≠本位币也要列出结算币种匹配的支付方式', () => {
  it('持有 USD（本位币 MYR），有一张卡结算币种也是 USD——这张卡要出现在"我的支付方式"组里，不再因为 hold≠base 被排除', async () => {
    const putSpy = vi.fn();
    const preferenceHoldUSD = {
      holdCurrency: 'USD',
      targetCurrency: 'THB',
      enabledCompareKeys: ['channel:wise', 'card:pm-round66-test'],
      amountYuan: 1000,
    };
    // 这次让 mock 卡的结算币种也是 'USD'，正好匹配"我持有 USD"。
    vi.stubGlobal('fetch', mockFetch(putSpy, preferenceHoldUSD, 'USD'));

    render(
      <FxCompareCard tripId={TRIP_ID} baseCurrency="MYR" hasPaymentMethods={true} enabledCurrencies={['MYR', 'THB', 'USD']} />
    );

    expect(await screen.findByText('DIAG测试卡')).toBeTruthy();
    // 结算币种匹配、卡组非空 ⇒ 不再是"0 行强制展开渠道"那条路径，默认渠道组
    // 收起（还能看到"看换汇渠道参考价"这个展开入口）。
    expect(screen.getByText('看换汇渠道参考价 ▾')).toBeTruthy();

    // 文案说明区要如实提到这几张卡是按"我持有"筛出来的，不是全量。
    expect(screen.getByText(/结算币种是/)).toBeTruthy();
  });

  it('顶部结论行：展开渠道组后，"最划算"跨渠道+我的支付方式全体比较，不再收窄在卡片组内部', async () => {
    const putSpy = vi.fn();
    // 把这张卡的成本压得很差（costInCompareCurrency 故意设一个很大的数字，implied
    // rate 会很低），保证真实的"最划算"落在某个渠道行上，用来证明徽章/结论没有被
    // 收窄成"只在卡片组里选"。
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/fx-compare-preference') && method === 'GET') {
          return new Response(JSON.stringify({ preference: SAVED_PREFERENCE }), { status: 200 });
        }
        if (url.includes('/fx-compare-preference') && method === 'PUT') {
          putSpy();
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (url.includes('/fx-mid-rates')) return new Response('fail', { status: 500 });
        if (url.includes('/fx-recommendation') && method === 'POST') {
          return new Response(
            JSON.stringify({
              recommendations: [
                {
                  paymentMethodId: PAYMENT_METHOD_ID,
                  label: 'DIAG测试卡（故意划不来）',
                  kind: 'card',
                  settlementCurrency: 'MYR',
                  costInCompareCurrency: 100000000, // 故意很贵，implied rate 很差
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
      })
    );

    render(
      <FxCompareCard tripId={TRIP_ID} baseCurrency="MYR" hasPaymentMethods={true} enabledCurrencies={['MYR', 'THB']} />
    );

    await waitFor(() => expect(screen.getByText('DIAG测试卡（故意划不来）')).toBeTruthy());
    // 展开渠道组，让 Wise/TNG 等渠道行也进入"当前可见"范围。
    fireEvent.click(screen.getByText('看换汇渠道参考价 ▾'));
    await waitFor(() => expect(screen.getByText('Wise')).toBeTruthy());

    // 顶部结论行出现，且指向的是"Wise"（渠道组里最划算的一行），不是那张故意划不来
    // 的卡——证明比较范围跨了组，不再收窄在"我的支付方式"内部。
    const conclusion = await screen.findByText(/最划算：Wise/);
    expect(conclusion).toBeTruthy();

    // 徽章也应该落在 Wise 那一行，不是卡片那一行。
    const wiseRow = screen.getByText('Wise').closest('li');
    expect(wiseRow?.textContent).toContain('✓最划算');
    const cardRow = screen.getByText('DIAG测试卡（故意划不来）').closest('li');
    expect(cardRow?.textContent).not.toContain('✓最划算');
  });

  it('渠道组标题标注"（参考价）"，跟真实持有的支付方式做区分', async () => {
    const putSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch(putSpy, SAVED_PREFERENCE));

    render(
      <FxCompareCard tripId={TRIP_ID} baseCurrency="MYR" hasPaymentMethods={true} enabledCurrencies={['MYR', 'THB']} />
    );
    await waitFor(() => expect(screen.getByText('DIAG测试卡')).toBeTruthy());
    fireEvent.click(screen.getByText('看换汇渠道参考价 ▾'));

    expect(await screen.findByText('渠道换汇（参考价）')).toBeTruthy();
    expect(screen.getByText('我的支付方式')).toBeTruthy();
  });
});
