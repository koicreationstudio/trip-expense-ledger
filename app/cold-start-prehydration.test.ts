import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 冷启动落地页的主按钮，必须在 React 水合之前点也有用（第六十四轮）。
 *
 * 背景：钱包深链"冷启动间歇性失败"被报了 4 次"已修复"又被推翻，真根因不在深链本身，
 * 在它前面一步：打开身份链接落到「我的行程」列表，行程卡片是纯 `<button onClick>`，
 * JS 还没下载完时点下去等于白点（没有请求、没有跳转、没有提示）。生产环境原生
 * Playwright 实测：列表一出现就点 0/10，等水合完再点 10/10。
 *
 * 修法是渐进增强：卡片外面包真正的 `<form method="post" action=接口>` + 隐藏字段，
 * 水合前浏览器原生提交，接口认得表单提交、303 跳走；水合后 onSubmit 拦下来走 fetch。
 * 同行人打开邀请链接的「认领这个身份」是同一类冷启动入口，一起改了。
 *
 * 这份守护锁住的是结构：谁把 form 的 method/action 或隐藏字段删了、或者把提交按钮
 * 改回 type="button" + onClick，这里立刻红。真实浏览器时序由
 * `scripts/e2e-wallet-deeplink-probe.mjs`（E2E_LOGIN_CLICK=eager）负责。
 */

const ROOT = path.resolve(__dirname, '..');

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

function read(rel: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

/** 取出 `<form ...>` 开标签本身（到第一个不在 {} 里的 `>` 为止）。 */
function formOpenTags(src: string): string[] {
  const tags: string[] = [];
  let idx = src.indexOf('<form');
  while (idx !== -1) {
    let depth = 0;
    let end = idx;
    for (; end < src.length; end++) {
      const ch = src[end];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) break;
    }
    tags.push(src.slice(idx, end + 1));
    idx = src.indexOf('<form', end);
  }
  return tags;
}

const COLD_START_ENTRIES = [
  {
    file: 'app/my-trips.tsx',
    what: '首页「我的行程」行程卡片',
    action: '/api/account/switch-trip',
    hiddenField: 'tripId',
  },
  {
    file: 'app/invite/[code]/claim-form.tsx',
    what: '邀请页「认领这个身份」',
    action: '/api/invite/',
    hiddenField: 'participantId',
  },
];

describe('冷启动入口：水合之前点也要能用', () => {
  for (const entry of COLD_START_ENTRIES) {
    it(`${entry.what}（${entry.file}）是真正能原生提交的 POST 表单`, () => {
      const src = read(entry.file);
      const forms = formOpenTags(src).filter((t) => t.includes(entry.action));
      expect(forms.length, `${entry.file} 里找不到 action 指向 ${entry.action} 的 <form>`).toBeGreaterThan(0);
      for (const tag of forms) {
        expect(tag, 'form 必须 method="post"').toMatch(/method="post"/);
        expect(tag, '水合后要靠 onSubmit 拦下来走 fetch').toMatch(/onSubmit=/);
      }
      expect(src, `缺隐藏字段 name="${entry.hiddenField}"，原生提交时接口收不到参数`).toMatch(
        new RegExp(`<input[^>]*type="hidden"[^>]*name="${entry.hiddenField}"`)
      );
      // 入口按钮必须是 submit，不能退回 type="button" + onClick 那种只有水合后才有用的写法
      expect(src).toMatch(/type="submit"/);
    });
  }

  it('首页行程卡片不能再用 onClick 直接打开行程（那是水合前白点的老写法）', () => {
    const src = read('app/my-trips.tsx');
    expect(src).not.toMatch(/onClick=\{\(\) => onOpen\(/);
  });

  it('两个接口都认得原生表单提交（content-type 分支 + 303 跳转）', () => {
    for (const rel of ['app/api/account/switch-trip/route.ts', 'app/api/invite/[code]/claim/route.ts']) {
      const src = read(rel);
      expect(src, rel).toMatch(/application\/x-www-form-urlencoded/);
      expect(src, rel).toMatch(/request\.formData\(\)/);
      expect(src, rel).toMatch(/,\s*303\)/);
    }
  });
});
