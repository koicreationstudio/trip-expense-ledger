#!/usr/bin/env node
/**
 * 展开式面板/表单"跨页面导航后还开着"探针（第六十四轮，Bug B）。
 *
 * 逐个把行程里会展开的东西打开（新建钱包弹层/取款换汇/设置当前余额+钱包编辑态/
 * 深链进来的余额面板/头部切换行程面板/邀请管理表单），再用头部 tab、浏览器前进后退、
 * 键盘等方式离开又回来，检查回来/到新页面时它是不是还开着。任何一行 LEAK 退出码 1。
 *
 * 必须用专属测试账号（行程需要至少 1 个钱包 + 用户名下至少 2 个行程），不能用 Remy
 * 真实身份：这个脚本会在弹层里打字（不提交）。
 *
 *   E2E_IDENTITY_URL='https://.../id/<测试账号token>' E2E_TRIP_NAME='测试行程名' \
 *   npm run test:e2e:expandable-reset
 */
import { chromium } from 'playwright';

const BASE = (process.env.E2E_BASE_URL || 'https://trip-expense-ledger.remybali.workers.dev').replace(/\/$/, '');
const IDENTITY_URL = process.env.E2E_IDENTITY_URL;
const TRIP_A_NAME = process.env.E2E_TRIP_NAME;
if (!IDENTITY_URL || !TRIP_A_NAME) {
  console.error('缺 E2E_IDENTITY_URL 或 E2E_TRIP_NAME（专属测试账号，不能用 Remy 真实身份）');
  process.exit(2);
}
const UA = 'Mozilla/5.0 (Macintosh) Chrome/140.0.0.0 Safari/537.36 E2E-PROBE-expandable-reset';
const VIEW = process.env.E2E_VIEWPORT === 'desktop' ? { width: 1280, height: 900 } : { width: 390, height: 844 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: VIEW, userAgent: UA });
const page = await context.newPage();
await page.goto(IDENTITY_URL);
await page.getByRole('heading', { name: '我的行程' }).waitFor();
await page.waitForFunction(() => {
  const el = document.querySelector('main button');
  return el && Object.keys(el).some((k) => k.startsWith('__reactProps'));
});
await page.locator('main button', { hasText: TRIP_A_NAME }).first().click();
await page.waitForURL(/\/trips\/[0-9a-f-]{36}$/);
const TRIP_A = new URL(page.url()).pathname.split('/')[2];
await sleep(1500);

const results = [];
async function check(name, isOpen) {
  await sleep(1500);
  const open = await isOpen().catch((e) => `ERR ${e}`);
  results.push({ name, stillOpen: open });
  console.log(`${open === false ? 'OK  ' : 'LEAK'} ${name} -> stillOpen=${open} url=${page.url().replace(BASE, '')}`);
}
const nav = (label) => page.locator('header a', { hasText: label }).first();
const home = async () => {
  await page.goto(`${BASE}/trips/${TRIP_A}`);
  await sleep(1500);
};

// S1 新建钱包 modal：goBack / goForward（弹层盖住整页，只能靠后退键或键盘离开）
const modal = () => page.locator('[role="dialog"][aria-label="新建钱包"]').isVisible();
for (const how of ['back-forward', 'keyboard-nav-link']) {
  await home();
  await nav('结算').click();
  await page.waitForURL(/settlement$/);
  await nav('行程主页').click();
  await page.waitForURL(new RegExp(`/trips/${TRIP_A}$`));
  await sleep(1200);
  await page.locator('button[aria-label="新建钱包"]').first().click();
  await page.locator('#wallet-label, [role="dialog"] input').first().fill('残留测试');
  if (how === 'back-forward') {
    await page.goBack();
    await page.waitForURL(/settlement$/);
    await sleep(800);
    await page.goForward();
    await page.waitForURL(new RegExp(`/trips/${TRIP_A}$`));
  } else {
    await nav('支付方式').focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(/payment-methods$/);
    await check('S1 新建钱包弹层 → 键盘进支付方式页(弹层应消失)', modal);
    await nav('行程主页').focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(new RegExp(`/trips/${TRIP_A}$`));
  }
  await check(`S1 新建钱包弹层 via ${how}`, modal);
}

// S2 取款/换汇 内联面板：头部导航去结算 → 头部导航回来 / 浏览器后退回来
const exch = () => page.getByText('💱 取款 / 换汇 ▲').isVisible();
for (const how of ['nav-nav', 'nav-back']) {
  await home();
  await page.getByText('💱 取款 / 换汇').click();
  await nav('结算').click();
  await page.waitForURL(/settlement$/);
  await sleep(800);
  if (how === 'nav-nav') await nav('行程主页').click();
  else await page.goBack();
  await page.waitForURL(new RegExp(`/trips/${TRIP_A}$`));
  await check(`S2 取款换汇面板 via ${how}`, exch);
}

// S3 支付方式页 设置当前余额面板 + 钱包行"设置"编辑态
const panel = () => page.locator('#set-balance').getByText('这里改的是钱包余额').isVisible();
for (const how of ['nav-nav', 'nav-back']) {
  await page.goto(`${BASE}/trips/${TRIP_A}/payment-methods`);
  await sleep(1500);
  await page.getByRole('button', { name: '⚙ 设置当前余额' }).click();
  await page.locator('#set-balance').getByRole('button', { name: '设置', exact: true }).first().click();
  await nav('结算').click();
  await page.waitForURL(/settlement$/);
  await sleep(800);
  if (how === 'nav-nav') await nav('支付方式').click();
  else await page.goBack();
  await page.waitForURL(/payment-methods$/);
  await check(`S3 设置余额面板 via ${how}`, panel);
}

// S4 深链(?openBalance=1) 进来之后再点头部「支付方式」(无参数) —— 同一页面组件只换 query
await page.goto(`${BASE}/trips/${TRIP_A}`);
await sleep(1500);
await page.locator('a[href*="openBalance=1"]').first().click();
await page.waitForURL(/openBalance=1/);
await sleep(1500);
await nav('支付方式').click();
await page.waitForURL(/payment-methods$/);
await check('S4 深链进来后点头部「支付方式」(应是收起态)', panel);

// S5 头部「切到其它行程」面板：打开后点同一个头部里的 tab 导航
const switcher = () => page.getByText('展开：切到其它行程').isVisible();
await home();
const trigger = page.locator('header button', { hasText: '▾' }).first();
const hasTrigger = await trigger.count();
if (hasTrigger) {
  await trigger.click();
  await sleep(500);
  const openedFirst = await switcher();
  await nav('结算').click();
  await page.waitForURL(/settlement$/);
  await check(`S5 切换行程面板(打开时=${openedFirst}) → 点头部结算 tab`, switcher);
} else {
  console.log('S5 skip: 找不到切换行程按钮');
}

// S6 邀请管理 生成邀请/添加同行人 展开
const inv = () => page.locator('main form').first().isVisible();
await page.goto(`${BASE}/trips/${TRIP_A}/invites`);
await sleep(1500);
const addBtn = page.locator('main button').filter({ hasText: /添加|生成/ });
console.log('S6 buttons:', await addBtn.allTextContents());
await addBtn.first().click();
await sleep(300);
const formOpenBefore = await inv();
await nav('结算').click();
await page.waitForURL(/settlement$/);
await sleep(800);
await nav('邀请管理').click();
await page.waitForURL(/invites$/);
await check(`S6 邀请管理展开表单(打开时=${formOpenBefore}) via nav-nav`, inv);

await browser.close();
const leaks = results.filter((r) => r.stillOpen !== false);
console.log(`\n${results.length - leaks.length}/${results.length} 没有残留`);
console.log('清理测试 session：DELETE FROM session / user_session WHERE user_agent LIKE \'%E2E-PROBE-expandable-reset%\'');
process.exit(leaks.length === 0 ? 0 : 1);
