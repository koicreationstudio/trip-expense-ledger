#!/usr/bin/env node
// 生成 lib/build-info.ts —— commit hash + 构建时间只能在"此刻正在构建"这一步
// 算出来，不能留到运行时再读：Cloudflare Workers 跑起来的环境没有 .git 目录，
// 运行时读 git 要嘛直接报错、要嘛读到部署机器当时随便什么值，两种都是假数据。
//
// 挂在 package.json 的 "prebuild" 钩子上，任何触发 `npm run build` 的路径都会
// 先跑到这个脚本 —— deploy.sh 走 `npx opennextjs-cloudflare build`（内部对
// npm 项目会自己执行 `npm run build`）、CI 的 `.github/workflows/ci.yml`
// 走同一条 opennextjs-cloudflare build 命令、本地手动 `npm run build` 也一样，
// 三条路径都不用额外改，写一次 prebuild 钩子全包了。
//
// lib/build-info.ts 本身照常进 git（不是 gitignore），好处是 lint/typecheck/
// test 这几步（deploy.sh 和 CI 都排在 build 之前）读到的是上一次提交时留下的
// 占位值，文件永远存在，不会因为"还没跑过 prebuild"就直接编译不过；真正准确
// 的值只在紧挨着实际部署的这次 build 里被写实。

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, '..', 'lib', 'build-info.ts');

function safeExec(cmd, fallback) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return fallback;
  }
}

const commitRaw = safeExec('git rev-parse --short HEAD', 'unknown');
// 只看"已被 git 追踪的文件有没有改动"（-uno 关掉 untracked 列表），不把 untracked
// 文件算进"dirty"——这个仓库一直有 audit-diffs/ 这类走查截图长期不进 git（约定
// 如此，不是遗漏），如果连 untracked 都算，"-dirty" 会变成常态、失去诊断意义。
const hasUncommittedChanges = safeExec('git status --porcelain --untracked-files=no', '') !== '';
const commit = hasUncommittedChanges && commitRaw !== 'unknown' ? `${commitRaw}-dirty` : commitRaw;
const buildTime = new Date().toISOString();

const content = `// 自动生成，别手改 —— scripts/generate-build-info.mjs 在每次 \`npm run build\`
// （prebuild 钩子）前重新算一遍，写实成"这次构建当下"的 git commit + 时间。
// 这份文件本身照常提交进 git，纯粹是让 lint/typecheck/test 在真正跑 build
// 之前也有个占位值可以 import，不会因为文件不存在直接编译失败；这里存的值
// 是不是当前 commit 不重要，重要的是每次实际部署前 prebuild 都会把它覆盖成
// 真实值。commit 后缀 "-dirty" 代表生成这份文件那一刻工作树有未提交改动
// （部署的代码不完全等于 HEAD 那个 commit，给 Remy 一个诚实提示）。
export const BUILD_COMMIT = ${JSON.stringify(commit)};
export const BUILD_TIME = ${JSON.stringify(buildTime)};
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, content, 'utf8');
console.log(`✓ lib/build-info.ts 已生成：${commit} @ ${buildTime}`);
