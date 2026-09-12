import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 底部操作条的结构守护。
 *
 * 背景：「记一笔消费」这个按钮以前是贴右下角的悬浮 FAB，跟页面内容抢同一块屏幕坐标，
 * 被反馈遮挡过三轮（列表行尾图标 → 参与者整行金额 → 汇率比价行）。前两轮的补法是给
 * 被挡的区块手动打 `data-fab-avoid` 标记、让 FAB 运行时量重叠自己抬——问题是"打标记"
 * 是个会漏的手工步骤，第三轮实测抓到的正是"这个区块从来没被登记过"。2026-09-12 改成
 * 操作条独占一条横带 + 页面容器预留同高空白，把"登记"这一步整个删掉。
 *
 * 这份守护盯住四条不变量，防止以后有人把悬浮胶囊那套改回来、或者让预留空白跟操作条
 * 高度各写各的悄悄漂移。全是静态读源码，不需要浏览器。
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const GLOBALS_CSS = path.join(REPO_ROOT, 'app/globals.css');
const TRIP_LAYOUT = path.join(REPO_ROOT, 'app/trips/[tripId]/layout.tsx');
const BAR_COMPONENT = path.join(REPO_ROOT, 'app/trips/[tripId]/record-expense-bar.tsx');

function collectSourceFiles(dirs: string[], exts: string[]): string[] {
  const out: string[] = [];
  for (const dir of dirs) {
    const abs = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs, { recursive: true, encoding: 'utf8' })) {
      const file = path.join(abs, entry);
      if (!exts.includes(path.extname(file))) continue;
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue; // 守护自己不参与扫描
      if (!fs.statSync(file).isFile()) continue;
      out.push(file);
    }
  }
  return out;
}

const SOURCE_FILES = collectSourceFiles(['app', 'components'], ['.tsx', '.ts', '.css']);

/**
 * 把注释挖掉再扫——这几条守护查的是"代码里还有没有这个东西"，注释里为了解释来龙去脉
 * 必然要提到 `data-fab-avoid`、`fixed right-4` 这些字眼（本文件和 record-expense-bar.tsx
 * 顶部注释都提了），不挖掉的话守护会被自己的说明文字触发，变成永远红的噪音。
 * 只挖 /* *\/ 块注释 + 整行的 // 和 * 开头行，不碰代码行里的内容（避免把 https:// 这类
 * 字符串误伤成注释）。
 */
function stripComments(src: string): string[] {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')) // 保留行号
    .split('\n')
    .map((line) => (/^\s*(\/\/|\*)/.test(line) ? '' : line));
}

describe('底部操作条结构守护', () => {
  it('扫描范围不是空的（守护本身没瞎）', () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(20);
    expect(SOURCE_FILES).toContain(BAR_COMPONENT);
  });

  it('① 不许再出现 data-fab-avoid 这种"手动登记要避让的区块"标记', () => {
    // 手动登记必然会漏（新区块没人记得打标记），这正是同一个遮挡 bug 反复发作的机制。
    const marker = ['data', 'fab', 'avoid'].join('-');
    const offenders = SOURCE_FILES.filter((f) =>
      stripComments(fs.readFileSync(f, 'utf8')).some((line) => line.includes(marker)),
    );
    expect(offenders.map((f) => path.relative(REPO_ROOT, f))).toEqual([]);
  });

  it('② 不许再出现贴底/贴角的 fixed 悬浮控件（全屏遮罩除外）', () => {
    // 贴底贴角的 fixed 元素就是跟内容抢坐标的那个形态。唯一允许的 fixed 是 ConfirmDialog
    // 那种 `fixed inset-0` 全屏遮罩（它盖住整个屏幕，语义上就是要挡住下面的东西），
    // 以及 globals.css 里那条 .action-bar（它有配套的 .action-bar-reserve 预留空白）。
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      for (const [lineNo, line] of stripComments(fs.readFileSync(file, 'utf8')).entries()) {
        // 只认 class 列表里的 `fixed` 这个 token（前后不能是字母/数字/连字符，
        // 否则 pm-fixed-fee 这种 id 也会被当成定位 class 误报）
        if (!/(?<![\w-])fixed(?![\w-])/.test(line)) continue;
        if (!/className|@apply|position\s*:/.test(line)) continue;
        if (/fixed\s+inset-0/.test(line)) continue; // 全屏遮罩，放行
        if (file === GLOBALS_CSS && /@apply[^;]*inset-x-0/.test(line)) continue; // .action-bar 自己
        offenders.push(`${path.relative(REPO_ROOT, file)}:${lineNo + 1}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('③ 操作条高度和页面预留空白必须共用 --action-bar-h（不许各写各的）', () => {
    const css = fs.readFileSync(GLOBALS_CSS, 'utf8');
    // 变量本身只定义一次
    const defs = css.match(/--action-bar-h\s*:/g) ?? [];
    expect(defs).toHaveLength(1);

    const bar = css.match(/\.action-bar\s*\{[^}]*\}/)?.[0] ?? '';
    const reserve = css.match(/\.action-bar-reserve\s*\{[^}]*\}/)?.[0] ?? '';
    expect(bar, '.action-bar 没定义').not.toBe('');
    expect(reserve, '.action-bar-reserve 没定义').not.toBe('');
    // 操作条的高度、预留空白的 padding-bottom，两边都必须是从这个变量算出来的
    expect(bar).toMatch(/height\s*:[^;]*var\(--action-bar-h\)/);
    expect(reserve).toMatch(/padding-bottom\s*:[^;]*var\(--action-bar-h\)/);
  });

  it('④ 行程页面容器必须挂上 action-bar-reserve，且真的渲染了操作条', () => {
    // 注意：必须挖掉注释再查。上面那段解释为什么要预留空白的注释里就写着
    // action-bar-reserve 这个词，直接 includes 整份文件的话，哪怕 className 上被人删了
    // 这个 class，守护也会被注释里的同名字眼喂饱、照样绿——实测变异确认过这个洞。
    const layout = stripComments(fs.readFileSync(TRIP_LAYOUT, 'utf8'));
    const hasReserveClass = layout.some(
      (line) => /className=/.test(line) && /(?<![\w-])action-bar-reserve(?![\w-])/.test(line),
    );
    expect(hasReserveClass, '行程页面容器的 className 上没挂 action-bar-reserve').toBe(true);
    expect(layout.some((line) => line.includes('<RecordExpenseBar'))).toBe(true);
    // 操作条自己必须用 .action-bar（而不是就地手写一套 fixed 定位绕开预留空白）
    const bar = stripComments(fs.readFileSync(BAR_COMPONENT, 'utf8'));
    expect(bar.some((line) => line.includes('className="action-bar"'))).toBe(true);
  });
});
