import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * "换了 session 身份、紧接着导航到一个新 URL"这一类操作的结构守护。
 *
 * 背景（2026-09-24，第四十二轮，冷启动路径钱包深链间歇性失败排查）：这个 app 有好几处
 * 客户端组件会先打一个会改写 tel_session/tel_user_session cookie 的接口（切换行程/
 * 认领身份/退出登录），成功后再 `router.push()` 到一个新 URL。App Router 的客户端
 * Router Cache 不保证紧跟着的 `router.push()` 一定会绕过缓存去要最新数据——这个项目
 * 自己早就在 `trip-header-nav.tsx`（切换行程）/`logout-button.tsx`（退出登录）两处
 * 踩出了"push 完必须紧跟一个 refresh() 强制拿新数据"这套用法，但"从首页行程列表点进
 * 一个行程"（`my-trips.tsx` `handleOpen`）和"认领邀请身份后去记账"（`claim-form.tsx`）
 * 这两处做的是完全同一件事，之前漏了这一步——独立 ui-auditor 真机复测证实了这条路径
 * 存在"URL 已经跳转但页面内容还在渲染上一屏"的可感知窗口期。
 *
 * 这份守护不是复现那个真实的浏览器时序竞态（纯静态源码扫描做不到），而是锁住"这个 app
 * 已经用血换来的经验规则"：任何文件只要同时出现"打一个会改 session 的接口"和
 * "router.push(跳到新 URL)"，就必须在同一个文件里也出现 `router.refresh()`，防止
 * 以后新增/修改这一类入口时又漏掉这一步，重演同一个 class 的 bug。
 */

const REPO_ROOT = path.resolve(__dirname, '../..');

// 已知会改写 session cookie 的接口——出现在 fetch() 调用里就代表"这个 handler 铸了/
// 撤了一个新 session"。字符串按源码里实际出现的写法收录（有的是字面量，有的是模板字符串
// 里的一段固定后缀），新增同类接口时把新的关键词加进来，这份清单本身就是文档。
const SESSION_MINT_MARKERS = ['/api/account/switch-trip', '/claim`', "'/claim'", '/api/account/logout'];

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

/** 挖掉注释再扫——这份文件顶部的说明就提到了 switch-trip/claim/router.refresh 这些
 * 关键词，不挖掉的话会被自己的注释喂出假阳性/假阴性。规则跟 record-expense-bar.test.ts
 * 那份守护一致，不重新发明一套。返回逐行数组（不是整份文本拼回去），因为下面要按"这个
 * fetch 调用之后紧跟的若干行"这种窗口去找 push/refresh，得保留行号。 */
function stripComments(src: string): string[] {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => (/^\s*(\/\/|\*)/.test(line) ? '' : line));
}

// 同一个文件里可能有好几个 handler，其中只有一个是"换 session 再导航"、其它是完全无关的
// 操作（比如 my-trips.tsx 里改行程名字的 handleSaveName 自己也调用了 router.refresh()）。
// 之前第一版守护是整份文件字符串包含检查，被这种"文件里别处凑巧也有 router.refresh()"
// 的情况喂成假阳性通过——mutation test 实测过（临时删掉 my-trips.tsx handleOpen 里的
// refresh()，测试仍然是绿的，说明是空壳）。改成"以命中 marker 的那一行为起点，往后数
// WINDOW 行" 的局部窗口检查，逼 push 和 refresh 落在同一个 handler 附近，不是随便在
// 文件某处出现就算数。
// 50 是量出来的：claim-form.tsx 里"打 /claim 接口"和"点按钮 router.push"隔着 30 行
// 有效代码（不同函数——一个在 handleSubmit 里发请求，一个在认领成功后的 JSX 分支里点
// 按钮），留够余量设成 50；my-trips.tsx 里 handleOpen 本身的 push/refresh 只隔 1 行，
// 而这个文件里唯一"看起来像但其实无关"的另一个 router.refresh()（改行程名字的
// handleSaveName）离 switch-trip 那次 fetch 有 89 行代码那么远，50 这个窗口不会
// 误伤把它当成"补齐了"。两头都用 mutation test 量过，不是拍脑袋定的数字。
const WINDOW = 50;

const SOURCE_FILES = collectSourceFiles(['app', 'components'], ['.tsx', '.ts']);

describe('session 换身份后导航必须 push+refresh 成对出现', () => {
  it('扫描范围不是空的（守护本身没瞎）', () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(20);
  });

  it('已知的换 session 场景仍然存在（守护盯的是真实文件，不是幻觉路径）', () => {
    // 这四个文件是这次任务动手前后都会命中 SESSION_MINT_MARKERS 的真实场景，
    // 确认它们还在被扫描到，避免以后有人搬文件导致守护静默失效。
    const known = [
      'app/my-trips.tsx',
      'app/invite/[code]/claim-form.tsx',
      'app/trips/[tripId]/trip-header-nav.tsx',
      'app/trips/[tripId]/logout-button.tsx',
    ].map((f) => path.join(REPO_ROOT, f));
    for (const f of known) {
      expect(SOURCE_FILES, `${path.relative(REPO_ROOT, f)} 没被扫描范围覆盖到`).toContain(f);
    }
  });

  it('打了换 session 的接口后，同一个 handler 附近的 router.push() 必须紧跟 router.refresh()', () => {
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      const rawLines = stripComments(fs.readFileSync(file, 'utf8'));
      // 窗口只数"有实际内容的代码行"，不数空行/被挖空的注释行——否则一段解释来龙去脉的
      // 长注释（这份守护自己改的那两处 fix 就带了十几行注释）会把窗口预算白白吃掉，
      // 窗口内永远搜不到本来紧挨着的 push/refresh，变成假阴性（mutation test 实测踩过
      // 这个坑：第一版用"原始行号窗口"，故意删掉 my-trips.tsx 里的 refresh() 后测试
      // 仍然是绿的，因为 fetch 调用和 push 之间隔了一段解释性注释，窗口还没数到 push
      // 就用完了）。
      const codeLines = rawLines
        .map((content, idx) => ({ content, idx }))
        .filter(({ content }) => content.trim() !== '');

      for (const [pos, { content, idx }] of codeLines.entries()) {
        const mintsSession = SESSION_MINT_MARKERS.some((marker) => content.includes(marker));
        if (!mintsSession) continue;
        const windowLines = codeLines.slice(pos, pos + WINDOW);
        const pushIdx = windowLines.findIndex((l) => /router\.push\(/.test(l.content));
        if (pushIdx === -1) continue; // 这次调用没有紧跟着跳新 URL（比如纯粹的 GET 状态查询），不归这条守护管
        const hasRefreshNearby = windowLines.slice(pushIdx).some((l) => /router\.refresh\(\)/.test(l.content));
        if (!hasRefreshNearby) {
          offenders.push(`${path.relative(REPO_ROOT, file)}:${idx + 1}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
