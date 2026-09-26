// @vitest-environment jsdom
/**
 * 第六十八轮任务 J：支付方式页两处金额输入框（新增支付方式"固定费" + 钱包"设置
 * 当前余额"）加千分位。三个百分比字段（汇率加点/境外手续费/返现）故意不在范围内。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// round72b：改名交互加了 `router.refresh()`（成功 PATCH 后跟 my-trips.tsx 改行程名
// 同一套 push/refresh 写法），这个文件之前没用过 useRouter，jsdom 渲染不到真实的
// Next App Router 会直接抛 "invariant expected app router to be mounted"，跟这个项目
// 别处（expense-form.test.tsx 等）同款 mock。
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { PaymentMethodsManager } from './payment-methods-manager';

function callArg(spy: ReturnType<typeof vi.fn>, callIndex = 0): any {
  const call = spy.mock.calls[callIndex];
  if (!call) throw new Error(`spy 没有被调用第 ${callIndex + 1} 次`);
  return call[0];
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TRIP_ID = 'trip-round68-pm-test';

const WALLET = {
  id: 'w1',
  label: '现金钱包',
  currency: 'MYR',
  emoji: '💰',
  currentBalance: 500000, // 5000.00 元
  balanceUpdatedAt: null,
  paymentMethodId: null,
};

// 防覆盖确认流程（2026-09-26 新增）：POST balance-preview 不写库，纯算"改前/改后
// 现余额"给确认页看。测试用的假逻辑只需要满足两条契约——不带新值时回"改前"这一半，
// 带了新值时把 displayBalanceAfter 算成 newCurrentBalance 本身（这份 mock 不需要
// 真的重现 computeWalletDisplayBalance 那套推导公式，那部分交给后端路由的
// vitest 单独覆盖，这里只关心前端拿到响应之后有没有正确渲染/提交）。
function mockFetch(opts: { postSpy?: (body: any) => void; patchSpy?: (body: any) => void; previewSpy?: (body: any) => void }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.endsWith('/payment-methods') && method === 'GET') {
      return new Response(JSON.stringify({ paymentMethods: [] }), { status: 200 });
    }
    if (url.endsWith('/wallets') && method === 'GET') {
      return new Response(JSON.stringify({ wallets: [WALLET] }), { status: 200 });
    }
    if (url === '/api/payment-methods' && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      opts.postSpy?.(body);
      return new Response(JSON.stringify({ paymentMethod: { id: 'pm-1' } }), { status: 200 });
    }
    if (url.endsWith(`/wallets/${WALLET.id}/balance-preview`) && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      opts.previewSpy?.(body);
      const hasNewValues = body.newCurrentBalance !== undefined;
      return new Response(
        JSON.stringify({
          prevAmount: WALLET.balanceUpdatedAt ? WALLET.currentBalance : null,
          prevEffectiveDate: WALLET.balanceUpdatedAt,
          displayBalanceBefore: WALLET.currentBalance,
          displayBalanceAfter: hasNewValues ? body.newCurrentBalance : null,
        }),
        { status: 200 }
      );
    }
    if (url.endsWith(`/wallets/${WALLET.id}/balance-history`) && method === 'GET') {
      return new Response(JSON.stringify({ history: [] }), { status: 200 });
    }
    if (url.includes(`/wallets/${WALLET.id}`) && method === 'PATCH') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      opts.patchSpy?.(body);
      return new Response(JSON.stringify({ wallet: { ...WALLET, currentBalance: body.currentBalance } }), {
        status: 200,
      });
    }
    throw new Error(`未预期的请求：${method} ${url}`);
  });
}

describe('PaymentMethodsManager — 第六十八轮任务 J：固定费输入框千分位', () => {
  it('固定费展示带千分位，提交后 fixedFee（分）正确', async () => {
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch({ postSpy }));

    render(<PaymentMethodsManager tripId={TRIP_ID} />);
    await waitFor(() => expect(screen.getByText('还没配置任何支付方式。')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '测试卡' } });
    const fixedFeeInput = screen.getByLabelText('固定费（结算币种，元）') as HTMLInputElement;
    expect(fixedFeeInput.type).toBe('text');
    fireEvent.change(fixedFeeInput, { target: { value: '1250.5', selectionStart: 7 } });
    expect(fixedFeeInput.value).toBe('1,250.5');

    fireEvent.click(screen.getByRole('button', { name: '添加支付方式' }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(callArg(postSpy).fixedFee).toBe(125050);
  });

  it('粘贴带逗号数字不产生 NaN', async () => {
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch({ postSpy }));

    render(<PaymentMethodsManager tripId={TRIP_ID} />);
    await waitFor(() => expect(screen.getByText('还没配置任何支付方式。')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '测试卡2' } });
    const fixedFeeInput = screen.getByLabelText('固定费（结算币种，元）') as HTMLInputElement;
    fireEvent.change(fixedFeeInput, { target: { value: '1,500', selectionStart: 5 } });
    expect(fixedFeeInput.value).toBe('1,500');

    fireEvent.click(screen.getByRole('button', { name: '添加支付方式' }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(callArg(postSpy).fixedFee).toBe(150000);
    expect(Number.isNaN(callArg(postSpy).fixedFee)).toBe(false);
  });
});

describe('PaymentMethodsManager — 第六十八轮任务 J：钱包"设置当前余额"输入框千分位', () => {
  it('编辑回填：已有余额（500000 分）展示成 "5,000"，不是裸数字', async () => {
    vi.stubGlobal('fetch', mockFetch({}));

    // 不传 `defaultOpenBalancePanel`——那条路径会触发一个只在真实浏览器里才有的
    // `scrollIntoView` 调用，jsdom 没实现这个 API 会直接抛错。手动点开"⚙设置当前
    // 余额"折叠面板，效果跟 `defaultOpenBalancePanel` 打开面板这一步是一样的，
    // 只是不触发那段滚动副作用，不影响这条测试要验证的千分位这件事。
    render(<PaymentMethodsManager tripId={TRIP_ID} />);
    await waitFor(() => expect(screen.getByText('还没配置任何支付方式。')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '⚙ 设置当前余额' }));
    await waitFor(() => expect(screen.getByText('现金钱包')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    // fix(2026-09-26，防覆盖确认流程)：点"设置"之后表单第一步先异步查一次锚点信息
    // （balance-preview 不带新值），要等这次请求回来才会渲染下面的输入框。
    const balanceInput = (await screen.findByLabelText('新余额（MYR）')) as HTMLInputElement;
    expect(balanceInput.type).toBe('text');
    expect(balanceInput.value).toBe('5,000');
  });

  it('改成新余额（带千分位/小数），走完"下一步→确认保存"两步后 PATCH body 的 currentBalance（分）正确', async () => {
    const patchSpy = vi.fn();
    const previewSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch({ patchSpy, previewSpy }));

    render(<PaymentMethodsManager tripId={TRIP_ID} />);
    await waitFor(() => expect(screen.getByText('还没配置任何支付方式。')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '⚙ 设置当前余额' }));
    await waitFor(() => expect(screen.getByText('现金钱包')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '设置' }));

    const balanceInput = (await screen.findByLabelText('新余额（MYR）')) as HTMLInputElement;
    fireEvent.change(balanceInput, { target: { value: '12500.75', selectionStart: 8 } });
    expect(balanceInput.value).toBe('12,500.75');

    // fix(2026-09-26)：生效日期不预填，必须自己选一天才能进入下一步（见④这条测试
    // 覆盖的另一个场景——这里先走"选了日期"的正常路径）。
    const dateInput = screen.getByLabelText('生效日期') as HTMLInputElement;
    expect(dateInput.value).toBe('');
    fireEvent.change(dateInput, { target: { value: '2026-09-25' } });

    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    // 「下一步」带着新值再查一次 balance-preview 拿"改后现余额"，进入确认页才有
    // "确认保存"这颗按钮。
    await waitFor(() => expect(screen.getByRole('button', { name: '确认保存' })).toBeTruthy());
    expect(previewSpy).toHaveBeenCalledWith({ newCurrentBalance: 1250075, newBalanceUpdatedAt: expect.any(String) });

    fireEvent.click(screen.getByRole('button', { name: '确认保存' }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(callArg(patchSpy).currentBalance).toBe(1250075);
    expect(callArg(patchSpy).balanceUpdatedAt).toBeTruthy();
  });

  it('④生效日期不预填、必须选才能进入下一步——不选日期点"下一步"会被挡下来，不会发出预览请求', async () => {
    const previewSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetch({ previewSpy }));

    render(<PaymentMethodsManager tripId={TRIP_ID} />);
    await waitFor(() => expect(screen.getByText('还没配置任何支付方式。')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '⚙ 设置当前余额' }));
    await waitFor(() => expect(screen.getByText('现金钱包')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '设置' }));

    await screen.findByLabelText('新余额（MYR）');
    const dateInput = screen.getByLabelText('生效日期') as HTMLInputElement;
    expect(dateInput.value).toBe(''); // 没有任何预填值，包括今天

    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await waitFor(() => expect(screen.getByText(/请选择生效日期/)).toBeTruthy());
    // previewSpy 在 startEditBalance 那次"查当前锚点"的请求里会被调用一次（不带
    // 新值），但不该再多一次"带新值"的调用——用这一点区分"没有真的往下一步走"。
    expect(previewSpy).toHaveBeenCalledTimes(1);
    expect(callArg(previewSpy)).toEqual({});
    expect(screen.queryByRole('button', { name: '确认保存' })).toBeNull();
  });
});

describe('PaymentMethodsManager — 第七十一轮第二版：不再靠人造占位块解决滚动不到位，改滚真实文档底部', () => {
  it('内容很短（目标之后剩余真实内容 < 一屏）时，不渲染任何占位 div，改用 window.scrollTo 滚到真实文档底部', async () => {
    // jsdom 没实现 scrollIntoView，手动打桩；rAF 同步跑回调，跳过真实动画帧等待。
    const scrollIntoViewSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewSpy;
    const scrollToSpy = vi.fn();
    vi.stubGlobal('scrollTo', scrollToSpy);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    // 同第三十九轮踩过的场景：视口 800px，目标区块距页面顶部 900px，页面总高度只有
    // 1000px——目标之后剩余真实内容只有 1000-900=100px，远小于一屏，触发"滚到真实
    // 底部"分支，而不是 scrollIntoView。
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 1000, configurable: true });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.id === 'set-balance') {
        return { top: 900, left: 0, right: 0, bottom: 900, width: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
      }
      return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
    });

    vi.stubGlobal('fetch', mockFetch({}));
    render(<PaymentMethodsManager tripId={TRIP_ID} defaultOpenBalancePanel />);
    await waitFor(() => expect(screen.getByText('现金钱包')).toBeTruthy());

    await waitFor(() => expect(scrollToSpy).toHaveBeenCalledWith({ top: 200 })); // 1000-800=200，滚到真实文档底部
    // 核心断言：这条路径完全没调用 scrollIntoView（不强求顶到视口最上面），也没有
    // 在 DOM 里留下任何占位 div——彻底不制造人造空白。
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    expect(document.querySelector('div[aria-hidden="true"][style]')).toBeNull();

    vi.restoreAllMocks();
  });

  it('内容已经够长（目标之后剩余真实内容 >= 一屏）时，维持第三十九轮原本的 scrollIntoView({block:"start"})，不受影响', async () => {
    const scrollIntoViewSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewSpy;
    const scrollToSpy = vi.fn();
    vi.stubGlobal('scrollTo', scrollToSpy);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    // 视口 800，页面总高度 2000，目标区块在 500px 处——目标之后剩余真实内容
    // 2000-500=1500px，大于一屏，走 scrollIntoView 这条老路径。
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 2000, configurable: true });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.id === 'set-balance') {
        return { top: 500, left: 0, right: 0, bottom: 500, width: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
      }
      return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
    });

    vi.stubGlobal('fetch', mockFetch({}));
    render(<PaymentMethodsManager tripId={TRIP_ID} defaultOpenBalancePanel />);
    await waitFor(() => expect(screen.getByText('现金钱包')).toBeTruthy());
    await waitFor(() => expect(scrollIntoViewSpy).toHaveBeenCalledWith({ block: 'start' }));

    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(document.querySelector('div[aria-hidden="true"][style]')).toBeNull();

    vi.restoreAllMocks();
  });
});

describe('PaymentMethodsManager — round72b：点名字进入编辑态改名', () => {
  const METHOD_ID = 'pm-rename-1';
  const ORIGINAL_LABEL = '汇丰信用卡';

  /**
   * 独立于上面 `mockFetch`（那个固定回空列表，改名要点名字得先有一条真实数据）。
   * `currentLabel` 是个可变闭包变量：PATCH 成功后更新它，下一次 `loadMethods()`
   * 重新 GET 时能看到改名后的结果，跟真实后端行为一致（不是测试自己伪造"看起来
   * 已经改了"）。
   */
  function mockFetchForRename(opts: {
    patchSpy?: (body: any) => void;
    patchStatus?: number;
  }) {
    let currentLabel = ORIGINAL_LABEL;
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();

      if (url.endsWith('/wallets') && method === 'GET') {
        return new Response(JSON.stringify({ wallets: [] }), { status: 200 });
      }
      if (url.includes('/payment-methods') && method === 'GET') {
        return new Response(
          JSON.stringify({
            paymentMethods: [
              {
                id: METHOD_ID,
                label: currentLabel,
                kind: 'card',
                settlementCurrency: 'MYR',
                fxMarkupPercent: 0,
                foreignTxnFeePercent: 0,
                fixedFee: 0,
                cashbackPercent: 0,
                isActive: true,
                sortOrder: 0,
                enabled: true,
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url === `/api/payment-methods/${METHOD_ID}` && method === 'PATCH') {
        const body = JSON.parse(String(init?.body ?? '{}'));
        opts.patchSpy?.(body);
        const status = opts.patchStatus ?? 200;
        if (status >= 200 && status < 300) {
          currentLabel = body.label;
          return new Response(
            JSON.stringify({ paymentMethod: { id: METHOD_ID, label: currentLabel } }),
            { status }
          );
        }
        return new Response(JSON.stringify({ error: 'server_error' }), { status });
      }
      throw new Error(`未预期的请求：${method} ${url}`);
    });
  }

  async function renderAndOpenEdit() {
    render(<PaymentMethodsManager tripId={TRIP_ID} />);
    const editButton = await screen.findByRole('button', { name: `编辑支付方式名称「${ORIGINAL_LABEL}」` });
    fireEvent.click(editButton);
    return screen.getByLabelText('支付方式名称') as HTMLInputElement;
  }

  it('①点击名字进入编辑态，input 预填当前值', async () => {
    vi.stubGlobal('fetch', mockFetchForRename({}));
    const input = await renderAndOpenEdit();
    expect(input.value).toBe(ORIGINAL_LABEL);
  });

  it('②保存成功后 PATCH body 正确、编辑态退出', async () => {
    const patchSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetchForRename({ patchSpy }));
    const input = await renderAndOpenEdit();

    fireEvent.change(input, { target: { value: 'HSBC 万事达卡' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(callArg(patchSpy)).toEqual({ label: 'HSBC 万事达卡' });

    // 编辑态退出：输入框不再挂载。
    await waitFor(() => expect(screen.queryByLabelText('支付方式名称')).toBeNull());
    // loadMethods() 重新拉取后，列表上显示的确实是新名字。
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '编辑支付方式名称「HSBC 万事达卡」' })).toBeTruthy()
    );
  });

  it('③取消按钮恢复原值不发请求', async () => {
    const patchSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetchForRename({ patchSpy }));
    const input = await renderAndOpenEdit();

    fireEvent.change(input, { target: { value: '改了一半又不想改了' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(patchSpy).not.toHaveBeenCalled();
    // 编辑态退出，原名字原样显示，没有发生任何请求。
    expect(screen.queryByLabelText('支付方式名称')).toBeNull();
    expect(screen.getByRole('button', { name: `编辑支付方式名称「${ORIGINAL_LABEL}」` })).toBeTruthy();
  });

  it('④保存空字符串（含纯空白）被拦下不发请求，显示错误提示，编辑态不退出', async () => {
    const patchSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetchForRename({ patchSpy }));
    const input = await renderAndOpenEdit();

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(patchSpy).not.toHaveBeenCalled();
    expect(await screen.findByText('名称不能空着')).toBeTruthy();
    // 编辑态没有被打断，输入框还在，人可以直接改了重试。
    expect(screen.getByLabelText('支付方式名称')).toBeTruthy();
  });

  it('⑤保存失败（后端非 2xx）显示清楚的错误信息，编辑态不退出、原名字不会看起来"已经改了"', async () => {
    const patchSpy = vi.fn();
    vi.stubGlobal('fetch', mockFetchForRename({ patchSpy, patchStatus: 500 }));
    const input = await renderAndOpenEdit();

    fireEvent.change(input, { target: { value: '新名字但会保存失败' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('改名失败，检查一下网络再试一次')).toBeTruthy();
    // 编辑态还在（不会卡死也不会静默退出假装成功），原名字没有被顶掉。
    expect(screen.getByLabelText('支付方式名称')).toBeTruthy();
    expect(screen.queryByRole('button', { name: `编辑支付方式名称「新名字但会保存失败」` })).toBeNull();
  });
});
