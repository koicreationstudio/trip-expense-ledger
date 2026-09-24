import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 「展开的面板/表单跨页面导航后还开着」这一类的结构守护（第六十四轮，Bug B 横扫）。
 *
 * 生产实测查出来两种会让展开状态"跟着人走到下一页"的结构，都是组件实例在导航后
 * 没有重新挂载，`useState` 里的开关沿用了上一页的值：
 *
 * 1. 同一个页面只换 URL 参数。Next 14 对 `/x?a=1` ↔ `/x` 不重新挂载页面里的组件，
 *    组件里 `useState(从参数算出来的初始值)` 只在第一次挂载读一次。支付方式页的
 *    `?openBalance=1` 就是这样：深链进来再点头部「支付方式」面板还开着；反过来后退
 *    回深链 URL 面板却是收起的（钱包深链 bug 的症状②）。修法：把参数做成 `key`。
 *    规则：page.tsx 里任何把 searchParams（或从它算出来的变量）当 prop 传给组件的
 *    地方，同一个标签上必须有同样由 searchParams 算出来的 `key`。
 *
 * 2. 挂在共享 layout 里的组件。切 tab 时 layout 不重新挂载。行程头部「切到其它行程」
 *    面板开着点「结算」tab，到了结算页面板还展开。修法：路径一变就收起。
 *    规则：trip 布局里带开关状态的组件必须有"pathname 变了就 setOpen(false)"的 effect。
 *
 * 真实浏览器验证在 `scripts/e2e-wallet-deeplink-probe.mjs`（p5 路径）和
 * `scripts/e2e-expandable-reset-probe.mjs`。
 */

const ROOT = path.resolve(__dirname, '..');

function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

function listFiles(dir: string, name: RegExp): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { recursive: true, encoding: 'utf8' })) {
    if (name.test(path.basename(entry))) out.push(path.join(dir, entry));
  }
  return out;
}

/** 取 JSX 开标签（`<Capitalized ...>` / `.../>`），按花括号深度找结尾。 */
function componentTags(src: string): string[] {
  const tags: string[] = [];
  const re = /<([A-Z][A-Za-z0-9.]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 0;
    let end = m.index;
    for (; end < src.length; end++) {
      const ch = src[end];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) break;
    }
    tags.push(src.slice(m.index, end + 1));
  }
  return tags;
}

/** searchParams 以及 `const x = ...searchParams...` 这种由它算出来的别名（守护要追别名）。 */
function taintedNames(src: string): string[] {
  const names = new Set(['searchParams']);
  let grew = true;
  while (grew) {
    grew = false;
    for (const m of src.matchAll(/const\s+(\w+)\s*=\s*([^;\n]+)/g)) {
      const name = m[1]!;
      const expr = m[2]!;
      if (!names.has(name) && [...names].some((n) => new RegExp(`\\b${n}\\b`).test(expr))) {
        names.add(name);
        grew = true;
      }
    }
  }
  return [...names];
}

/** 拿 `attr={...}` 的表达式（按花括号配对）。 */
function attrExpr(tag: string, attr: string): string | null {
  const start = tag.search(new RegExp(`\\b${attr}=\\{`));
  if (start === -1) return null;
  let i = tag.indexOf('{', start);
  let depth = 0;
  const from = i;
  for (; i < tag.length; i++) {
    if (tag[i] === '{') depth++;
    else if (tag[i] === '}' && --depth === 0) break;
  }
  return tag.slice(from + 1, i);
}

export function findUnkeyedSearchParamProps(src: string): string[] {
  const clean = stripComments(src);
  const tainted = taintedNames(clean);
  const uses = (expr: string) => tainted.some((n) => new RegExp(`\\b${n}\\b`).test(expr));
  const problems: string[] = [];
  for (const tag of componentTags(clean)) {
    const tagName = tag.match(/^<([A-Za-z0-9.]+)/)![1]!;
    if (tagName === 'Link') continue; // href 带参数是导航目标，不是组件初始状态
    const propExprs = [...tag.matchAll(/\b(\w+)=\{/g)]
      .map((m) => m[1]!)
      .filter((a) => a !== 'key')
      .map((a) => attrExpr(tag, a) ?? '');
    if (!propExprs.some(uses)) continue;
    const key = attrExpr(tag, 'key');
    if (!key || !uses(key)) problems.push(tagName);
  }
  return problems;
}

describe('同一页面只换 URL 参数：由参数决定初始状态的组件必须带同源 key', () => {
  const pages = listFiles('app', /^page\.tsx$/);

  it('扫描范围里确实有吃 searchParams 的页面（防止守护悄悄扫空）', () => {
    const withParams = pages.filter((p) => /searchParams/.test(fs.readFileSync(path.join(ROOT, p), 'utf8')));
    expect(withParams.length).toBeGreaterThanOrEqual(3);
  });

  for (const rel of pages) {
    it(rel, () => {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      expect(findUnkeyedSearchParamProps(src), `${rel} 这些组件吃了 searchParams 却没有同源 key`).toEqual([]);
    });
  }

  it('自检：规则本身抓得到没 key / 别名传参 / key 跟参数无关这三种写法', () => {
    expect(findUnkeyedSearchParamProps(`<Foo open={searchParams?.x === '1'} />`)).toEqual(['Foo']);
    expect(
      findUnkeyedSearchParamProps(`const step = searchParams?.step;\nconst s2 = step ?? 'a';\nreturn <Gate initialStep={s2} />;`)
    ).toEqual(['Gate']);
    expect(findUnkeyedSearchParamProps(`<Foo key="fixed" open={searchParams?.x === '1'} />`)).toEqual(['Foo']);
    expect(findUnkeyedSearchParamProps(`<Foo key={searchParams?.x ?? 'd'} open={searchParams?.x === '1'} />`)).toEqual([]);
    expect(findUnkeyedSearchParamProps(`<Link href={\`/a?\${searchParams?.x}\`}>x</Link>`)).toEqual([]);
  });
});

describe('挂在 trip 共享布局里的展开状态：换页就收起', () => {
  it('layout 里用到的带 useState 开关的组件都有 pathname 变化时收起的 effect', () => {
    const layout = stripComments(fs.readFileSync(path.join(ROOT, 'app/trips/[tripId]/layout.tsx'), 'utf8'));
    const imports = [...layout.matchAll(/import\s+\{\s*(\w+)\s*\}\s+from\s+'\.\/([\w-]+)'/g)];
    expect(imports.length).toBeGreaterThan(0);
    const checked: string[] = [];
    for (const imp of imports) {
      const file = imp[2]!;
      const src = stripComments(fs.readFileSync(path.join(ROOT, `app/trips/[tripId]/${file}.tsx`), 'utf8'));
      const openStates = [...src.matchAll(/const \[(\w*[Oo]pen\w*), (set\w+)\] = useState/g)];
      for (const st of openStates) {
        const name = st[1]!;
        const setter = st[2]!;
        checked.push(`${file}:${name}`);
        const reset = new RegExp(
          `useEffect\\(\\(\\) => \\{\\s*${setter}\\(false\\);?\\s*\\}, \\[pathname\\]\\)`
        );
        expect(src, `${file}.tsx 的 ${name} 换页时不会收起`).toMatch(reset);
      }
    }
    // trip-header-nav 的「切到其它行程」面板一定在清单里，扫空说明正则失效了
    expect(checked).toContain('trip-header-nav:open');
  });
});
