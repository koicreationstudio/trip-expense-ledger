#!/usr/bin/env node
/**
 * 钱包卡「去支付方式手动设置余额 →」深链回归探针（第六十四轮建）
 *
 * 这条深链前后被报"已修复"4 次、每次都被独立复测推翻。这份脚本就是为了以后不再
 * 靠"点一两次看着没问题"下结论：每条路径连跑 N 次，每次都同时核对三种历史上真实
 * 出现过的失败症状，外加网络/导航事件这类客观信号，最后给一张成功率表。
 *
 * 三种失败症状（第四十七轮实测记录过）：
 *   WRONG_PAGE    点了深链却落到别的页面（行程主页/结算/我的行程）
 *   SESSION_LOST  被弹回未登录的营销首页（tel_session 丢了）
 *   PANEL_CLOSED  URL 对了、页面也对了，但「设置当前余额」面板没自动展开
 *   NOT_IN_VIEW   面板展开了，但 #set-balance 不在视口里（没滚过去）
 *
 * 三条路径：
 *   p1 冷启动：全新无 cookie 浏览器上下文 → 身份链接登录 → 我的行程列表点卡片进行程
 *      → 点钱包卡深链。每次都是全新 context，所以每次会新铸 1 条 user_session +
 *      1 条 session（UA 带 E2E-PROBE 标记，跑完按标记清理）。
 *   p2 已登录刷新：同一个已登录 context，行程主页刷新后直接 goto 深链 URL。
 *   p3 快速连点：同一个 tab「点深链 → 后退 → 立刻再点」紧凑节奏反复做（第四十七轮
 *      的模式 B）。
 *
 * **必须用专属测试账号跑，绝不能用 Remy 的真实身份链接**（第五十六/五十八轮教训：
 * 反复登录会污染她的 session 历史，跟真实使用混在一起分不清）。身份链接只从环境变量
 * 读，不写进任何文件（第十八轮 token 误写进仓库的事故）。
 *
 * 用法：
 *   E2E_IDENTITY_URL='https://.../id/<测试账号token>' \
 *   E2E_TRIP_NAME='QA深链探针r64-可删除' \
 *   npm run test:e2e:wallet-deeplink
 *
 * 可选环境变量：
 *   E2E_BASE_URL   默认 https://trip-expense-ledger.remybali.workers.dev
 *   E2E_RUNS       每条路径跑几次，默认 10
 *   E2E_PATHS      跑哪几条，默认 p1,p2,p3
 *   E2E_VIEWPORT   mobile(390x844，默认) / desktop(1280x900)
 *   E2E_OUT_DIR    失败截图 + JSON 结果放哪，默认系统临时目录
 *   E2E_HEADED=1   开有头浏览器看着跑
 *   E2E_THROTTLE=1 CPU 4 倍降速 + 慢速 4G，模拟中端手机
 *   E2E_LOGIN_CLICK human(默认，看一眼列表再点卡片) / eager(列表标题一出来就点) /
 *                  hydrated(等 React 水合完再点，排查用的对照组)
 *
 * 退出码：全部通过 0，有任何一次失败 1，配置错误 2。
 *
 * 跑完记得按 UA 标记清理测试 session（脚本结尾会把要跑的 SQL 打印出来）。
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = (process.env.E2E_BASE_URL || 'https://trip-expense-ledger.remybali.workers.dev').replace(/\/$/, '');
const IDENTITY_URL = process.env.E2E_IDENTITY_URL;
const TRIP_NAME = process.env.E2E_TRIP_NAME;
const RUNS = Number(process.env.E2E_RUNS || 10);
const PATHS = (process.env.E2E_PATHS || 'p1,p2,p3').split(',').map((s) => s.trim());
const VIEWPORT =
  process.env.E2E_VIEWPORT === 'desktop' ? { width: 1280, height: 900 } : { width: 390, height: 844 };
const OUT_DIR = process.env.E2E_OUT_DIR || join(tmpdir(), `wallet-deeplink-probe-${Date.now()}`);
const HEADED = process.env.E2E_HEADED === '1';
// 登录后「我的行程」列表点行程卡片的时机：human(默认，看一眼再点) / eager(标题出来立刻点) / hydrated(等 React 水合完再点)
const LOGIN_CLICK = process.env.E2E_LOGIN_CLICK || 'human';
// E2E_THROTTLE=1：CPU 4 倍降速 + 慢速 4G，模拟真实手机
const THROTTLE = process.env.E2E_THROTTLE === '1';
const MARK = 'E2E-PROBE-wallet-deeplink';
const UA = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 ${MARK}`;

if (!IDENTITY_URL || !TRIP_NAME) {
  console.error('缺 E2E_IDENTITY_URL 或 E2E_TRIP_NAME。必须是专属测试账号，不能用 Remy 真实身份链接。');
  process.exit(2);
}
mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 贴近真人节奏：看一眼页面再点，不是毫秒级连发（第五十六轮：机器节奏本身会制造假象）
const humanPause = () => sleep(900 + Math.floor(Math.random() * 700));

/** 给一个 page 挂客观信号监听：主 frame 导航、document/RSC 请求、console error。 */
function instrument(page) {
  const log = [];
  const t0 = { v: Date.now() };
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) log.push({ at: Date.now(), t: Date.now() - t0.v, ev: 'nav', url: f.url() });
  });
  page.on('request', (req) => {
    const h = req.headers();
    const isRsc = h['rsc'] === '1' || req.url().includes('_rsc=');
    if (req.resourceType() === 'document' || isRsc) {
      log.push({ at: Date.now(), t: Date.now() - t0.v, ev: isRsc ? 'rsc-req' : 'doc-req', url: req.url() });
    } else if (req.method() !== 'GET') {
      log.push({ at: Date.now(), t: Date.now() - t0.v, ev: `${req.method()}-req`, url: req.url() });
    }
  });
  page.on('response', (res) => {
    const req = res.request();
    const isRsc = req.headers()['rsc'] === '1' || req.url().includes('_rsc=');
    if (req.resourceType() === 'document' || isRsc) {
      log.push({ at: Date.now(), t: Date.now() - t0.v, ev: 'res', status: res.status(), url: res.url() });
    }
  });
  page.on('requestfinished', (req) => {
    const isRsc = req.headers()['rsc'] === '1' || req.url().includes('_rsc=');
    if (req.resourceType() === 'document' || isRsc || req.method() !== 'GET') {
      log.push({ at: Date.now(), t: Date.now() - t0.v, ev: 'finished', url: req.url() });
    }
  });
  page.on('requestfailed', (req) => {
    log.push({ at: Date.now(), t: Date.now() - t0.v, ev: 'failed', url: req.url(), err: req.failure()?.errorText });
  });
  page.on('console', (m) => {
    if (m.type() === 'error') log.push({ at: Date.now(), t: Date.now() - t0.v, ev: 'console-error', text: m.text().slice(0, 200) });
  });
  return {
    mark(obj) {
      log.push({ at: Date.now(), t: Date.now() - t0.v, ...obj });
    },
    reset() {
      log.length = 0;
      t0.v = Date.now();
    },
    snapshot() {
      return log.slice();
    },
  };
}

async function readState(page, tripId) {
  const url = new URL(page.url());
  const dom = await page
    .evaluate(() => {
      const sec = document.getElementById('set-balance');
      const r = sec ? sec.getBoundingClientRect() : null;
      const h1 = document.querySelector('main h1')?.textContent?.trim() ?? null;
      const panelText = !!sec && (sec.textContent || '').includes('这里改的是钱包余额');
      return {
        h1,
        hasSection: !!sec,
        panelOpen: panelText,
        top: r ? Math.round(r.top) : null,
        innerHeight: window.innerHeight,
        scrollY: Math.round(window.scrollY),
        marketing: !!Array.from(document.querySelectorAll('a')).find((a) => a.textContent?.includes('用密码/PIN 登录')),
      };
    })
    .catch((e) => ({ error: String(e) }));
  return { path: url.pathname, search: url.search, ...dom, tripId };
}

function classify(s, tripId) {
  if (s.error) return 'EVAL_ERROR';
  if (s.marketing || (s.path === '/' && s.h1 === '消费记录')) return 'SESSION_LOST';
  if (s.path !== `/trips/${tripId}/payment-methods`) return 'WRONG_PAGE';
  if (!s.panelOpen) return 'PANEL_CLOSED';
  // 第三十九轮定下的目标是"区块贴到视口顶部"，不是"底边露出一点按钮就算"：
  // top 超过 120px 说明没滚过去（或滚过去又被弹回来），面板内容大半还在屏幕下面。
  if (s.top === null || s.top < -5 || s.top > 120) return 'NOT_IN_VIEW';
  return 'OK';
}

/** 点完深链之后：最多等 8 秒达到 OK，然后再静置 1.5 秒复核一次（抓"先对了又自己跳走"）。 */
async function settleAndJudge(page, tripId) {
  const deadline = Date.now() + 8000;
  let s;
  while (Date.now() < deadline) {
    s = await readState(page, tripId);
    if (classify(s, tripId) === 'OK') break;
    await sleep(150);
  }
  const firstOkAt = classify(s, tripId) === 'OK' ? 8000 - (deadline - Date.now()) : null;
  await sleep(1500);
  const final = await readState(page, tripId);
  const pageLog = await page.evaluate(() => (window.__probeLog || []).slice(-60)).catch(() => []);
  let verdict = classify(final, tripId);
  // 8 秒没到位不马上下结论：再等最多 12 秒看它是"卡死"还是"只是很慢"，两种要分开报。
  let lateOkAt = null;
  if (verdict !== 'OK') {
    const lateDeadline = Date.now() + 12000;
    while (Date.now() < lateDeadline) {
      if (classify(await readState(page, tripId), tripId) === 'OK') {
        lateOkAt = 9500 + (12000 - (lateDeadline - Date.now()));
        break;
      }
      await sleep(250);
    }
  }
  return { verdict, final, firstOkAt, lateOkAt, pageLog };
}

/** React 水合之后会在 DOM 节点上挂 __reactProps$xxx；没挂上 = onClick 还没接上，点了等于白点。 */
async function isHydrated(locator) {
  return locator
    .evaluate((el) => Object.keys(el).some((k) => k.startsWith('__reactProps')))
    .catch(() => null);
}

async function waitHydrated(page, selector) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return !!el && Object.keys(el).some((k) => k.startsWith('__reactProps'));
    },
    selector,
    { timeout: 20000 }
  );
}

function deeplink(page) {
  return page.locator('a[href*="/payment-methods?openBalance=1"]').first();
}

/**
 * 页面内插桩（第三十九轮同款思路）：记录每次 scrollIntoView 调用、scrollY 变化、
 * 「设置当前余额」区块载入中/载入完成的时刻，判定失败时一起落盘，
 * 用来回答"是没滚、还是滚了又被弹回去"。
 */
const PAGE_INSTRUMENT = () => {
  const log = [];
  window.__probeLog = log;
  const now = () => Math.round(performance.timeOrigin + performance.now());
  const orig = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (...args) {
    log.push({ at: now(), ev: 'scrollIntoView', id: this.id || this.tagName, before: Math.round(window.scrollY), sh: document.documentElement.scrollHeight });
    const r = orig.apply(this, args);
    log.push({ at: now(), ev: 'scrollIntoView-after', after: Math.round(window.scrollY) });
    return r;
  };
  let last = -1;
  const tick = () => {
    const y = Math.round(window.scrollY);
    if (y !== last) {
      log.push({ at: now(), ev: 'scrollY', y, sh: document.documentElement.scrollHeight, path: location.pathname + location.search });
      last = y;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

async function loginAndEnterTrip(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT, userAgent: UA });
  await context.addInitScript(PAGE_INSTRUMENT);
  const page = await context.newPage();
  if (THROTTLE) {
    // 模拟中端手机 + 一般 4G：CPU 降速 4 倍、150ms 往返延迟、约 1.6Mbps 下行
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
  }
  const probe = instrument(page);
  try {
    await page.goto(IDENTITY_URL, { waitUntil: 'domcontentloaded' });
    // /id/<token> → / → 没有 tel_session 时是「我的行程」列表
    await page.getByRole('heading', { name: '我的行程' }).waitFor({ timeout: 20000 });
    if (LOGIN_CLICK === 'hydrated') await waitHydrated(page, 'main button');
    else if (LOGIN_CLICK === 'human') await humanPause();
    // eager：标题一出来就点（手快的人/慢手机上 JS 还没下载完的真实情形）
    const card = page.locator('main button', { hasText: TRIP_NAME }).first();
    const hydratedAtClick = await isHydrated(card);
    probe.mark({ ev: 'click-trip-card', hydratedAtClick });
    await card.click();
    await page.waitForURL(/\/trips\/[0-9a-f-]{36}$/, { timeout: 15000, waitUntil: 'commit' });
    const tripId = new URL(page.url()).pathname.split('/')[2];
    await deeplink(page).waitFor({ state: 'visible', timeout: 20000 });
    return { context, page, probe, tripId, hydratedAtClick };
  } catch (e) {
    // 登录/进行程这一步本身失败也是冷启动路径的真实失败，留完整证据，不只报超时
    const shot = join(OUT_DIR, `login-fail-${Date.now()}.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    const body = await page.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => '');
    const err = new Error(`${String(e).split('\n')[0]} | url=${page.url()} | body=${JSON.stringify(body)} | shot=${shot}`);
    err.events = probe.snapshot();
    await context.close();
    throw err;
  }
}

async function clickDeeplink(page) {
  const link = deeplink(page);
  await link.scrollIntoViewIfNeeded();
  // E2E_DEEPLINK_CLICK=immediate：进了行程主页、深链一出现就点（手快的人）
  if (process.env.E2E_DEEPLINK_CLICK !== 'immediate') await humanPause();
  await link.click();
}

async function record(results, pathName, i, page, probe, judged, extra = {}) {
  const row = { path: pathName, run: i + 1, verdict: judged.verdict, firstOkAtMs: judged.firstOkAt, lateOkAtMs: judged.lateOkAt, final: judged.final, events: probe.snapshot(), pageLog: judged.pageLog, ...extra };
  results.push(row);
  const tag = judged.verdict === 'OK' ? 'OK ' : 'FAIL';
  console.log(
    `[${pathName} #${i + 1}] ${tag} ${judged.verdict} path=${judged.final.path}${judged.final.search ?? ''} panelOpen=${judged.final.panelOpen} top=${judged.final.top} firstOk=${judged.firstOkAt}ms${judged.lateOkAt ? ` lateOk=${judged.lateOkAt}ms` : ''} navs=${row.events.filter((e) => e.ev === 'nav').length}`
  );
  if (judged.verdict !== 'OK') {
    await page.screenshot({ path: join(OUT_DIR, `${pathName}-${i + 1}-${judged.verdict}.png`) }).catch(() => {});
  }
}

async function runP1(browser, results) {
  for (let i = 0; i < RUNS; i++) {
    let ctx;
    try {
      const { context, page, probe, tripId, hydratedAtClick } = await loginAndEnterTrip(browser);
      ctx = context;
      probe.reset();
      await clickDeeplink(page);
      await record(results, 'p1', i, page, probe, await settleAndJudge(page, tripId), { hydratedAtClick });
    } catch (e) {
      results.push({ path: 'p1', run: i + 1, verdict: 'LOGIN_ENTER_FAIL', error: String(e).slice(0, 1200), events: e.events });
      console.log(`[p1 #${i + 1}] FAIL LOGIN_ENTER_FAIL ${String(e).slice(0, 400)}`);
    } finally {
      await ctx?.close();
    }
    await sleep(2500);
  }
}

async function runP2(browser, results) {
  const { context, page, probe, tripId } = await loginAndEnterTrip(browser);
  try {
    for (let i = 0; i < RUNS; i++) {
      await page.goto(`${BASE}/trips/${tripId}`, { waitUntil: 'domcontentloaded' });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await humanPause();
      probe.reset();
      await page.goto(`${BASE}/trips/${tripId}/payment-methods?openBalance=1`, { waitUntil: 'domcontentloaded' });
      await record(results, 'p2', i, page, probe, await settleAndJudge(page, tripId));
    }
  } finally {
    await context.close();
  }
}

async function runP3(browser, results) {
  const { context, page, probe, tripId } = await loginAndEnterTrip(browser);
  try {
    for (let i = 0; i < RUNS; i++) {
      probe.reset();
      // 紧凑节奏：不 humanPause，后退后只等 250~450ms（真人按完返回马上再点的速度）
      const link = deeplink(page);
      await link.waitFor({ state: 'visible', timeout: 15000 });
      await link.scrollIntoViewIfNeeded();
      await link.click();
      const judged = await settleAndJudge(page, tripId);
      await record(results, 'p3', i, page, probe, judged);
      await page.goBack();
      await sleep(250 + Math.floor(Math.random() * 200));
    }
  } finally {
    await context.close();
  }
}

/**
 * p4：整页刷新行程主页后，深链一出现就马上点（不等它自己的预取跑完）。
 * 用 E2E_P4_WAIT_MS 控制点之前等多久，0 = 马上点（默认），2000 = 对照组。
 */
async function runP4(browser, results) {
  const waitMs = Number(process.env.E2E_P4_WAIT_MS || 0);
  const { context, page, probe, tripId } = await loginAndEnterTrip(browser);
  try {
    for (let i = 0; i < RUNS; i++) {
      await page.goto(`${BASE}/trips/${tripId}`, { waitUntil: 'domcontentloaded' });
      await waitHydrated(page, 'header button');
      probe.reset();
      const link = deeplink(page);
      await link.scrollIntoViewIfNeeded();
      if (waitMs) await sleep(waitMs);
      await link.click();
      await record(results, 'p4', i, page, probe, await settleAndJudge(page, tripId), { waitMs });
      await sleep(1500);
    }
  } finally {
    await context.close();
  }
}

/**
 * p5：同一个支付方式页只换 URL 参数（第六十四轮查出来的第二个真根因）。
 * 行程主页点深链（面板自动展开）→ 头部点「支付方式」（URL 没有 openBalance，
 * 面板应该是收起的）→ 浏览器后退回到 `?openBalance=1` 那一条。
 * 修之前：页面组件没有重新挂载，面板开关沿用上一刻的值，后退回深链 URL 时面板
 * 是收起的 = 第四十七轮记录的症状②"URL 带着 openBalance=1 但面板没展开"。
 */
async function runP5(browser, results) {
  const { context, page, probe, tripId } = await loginAndEnterTrip(browser);
  const panelOpen = () =>
    page.evaluate(() => (document.getElementById('set-balance')?.textContent || '').includes('这里改的是钱包余额'));
  try {
    for (let i = 0; i < RUNS; i++) {
      await page.goto(`${BASE}/trips/${tripId}`, { waitUntil: 'domcontentloaded' });
      await waitHydrated(page, 'header button');
      await clickDeeplink(page);
      const first = await settleAndJudge(page, tripId);
      await humanPause();
      await page.locator('header a', { hasText: '支付方式' }).first().click();
      await page.waitForURL(/\/payment-methods$/, { timeout: 15000 });
      await sleep(1200);
      const openOnPlainUrl = await panelOpen();
      // 有残留（修之前）就先手动收起，模拟人看到面板开着顺手关掉
      if (openOnPlainUrl) await page.getByRole('button', { name: '⚙ 设置当前余额' }).click();
      await humanPause();
      probe.reset();
      await page.goBack();
      const judged = await settleAndJudge(page, tripId);
      // 头部「支付方式」进来本该是收起态；带着深链打开的状态过去 = 残留（Bug B 同一类）
      if (judged.verdict === 'OK' && openOnPlainUrl) judged.verdict = 'STALE_OPEN_ON_PLAIN_URL';
      await record(results, 'p5', i, page, probe, judged, { firstLeg: first.verdict, openOnPlainUrl });
    }
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: !HEADED });
const results = [];
const started = new Date().toISOString();
try {
  if (PATHS.includes('p1')) await runP1(browser, results);
  if (PATHS.includes('p2')) await runP2(browser, results);
  if (PATHS.includes('p3')) await runP3(browser, results);
  if (PATHS.includes('p4')) await runP4(browser, results);
  if (PATHS.includes('p5')) await runP5(browser, results);
} finally {
  await browser.close();
}

const summary = {};
for (const r of results) {
  summary[r.path] ??= { runs: 0, ok: 0, verdicts: {} };
  summary[r.path].runs++;
  if (r.verdict === 'OK') summary[r.path].ok++;
  summary[r.path].verdicts[r.verdict] = (summary[r.path].verdicts[r.verdict] || 0) + 1;
}
writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify({ started, base: BASE, viewport: VIEWPORT, summary, results }, null, 2));

console.log('\n=== 汇总 ===');
for (const [p, s] of Object.entries(summary)) {
  console.log(`${p}: ${s.ok}/${s.runs} OK  ${JSON.stringify(s.verdicts)}`);
}
console.log(`详细结果 + 失败截图：${OUT_DIR}`);
console.log(
  `\n清理测试 session（UA 标记）：\n  npx wrangler d1 execute trip-expense-ledger-db --remote --command "DELETE FROM session WHERE user_agent LIKE '%${MARK}%'; DELETE FROM user_session WHERE user_agent LIKE '%${MARK}%';"`
);
const allOk = results.length > 0 && results.every((r) => r.verdict === 'OK');
process.exit(allOk ? 0 : 1);
