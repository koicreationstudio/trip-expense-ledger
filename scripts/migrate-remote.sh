#!/bin/bash
# trip-expense-ledger D1 生产迁移关卡 — 不准直接裸跑
# `wrangler d1 migrations apply trip-expense-ledger-db --remote` /
# `npm run db:migrate:remote`（settings.json 已 deny 这两种直接调用），强制走这个脚本。
#
# 背景（2026-09-23 round35 事故根因之一，团队看板 id=2026-09-23_165930_ce219d6b）：
#   deploy.sh 补了「工作树干净 + HEAD 已推 origin/main」这道闸门（① 关），但生产 D1
#   migration 一直没有对应闸门——round30 那次密码/PIN 找回功能出事时，正是因为迁移
#   （schema 改动）跟 Worker 代码部署完全没有协调机制，谁想跑就直接裸跑 `wrangler d1
#   migrations apply --remote`，可能在 Worker 代码还没部署、或者部署的 Worker 代码跟
#   这份迁移对不上号的情况下就把生产 D1 schema 改了，产生「代码要这一列但生产库还没有」
#   或者反过来「生产库多了一列但代码还没引用」的半成品状态窗口。
#
# 关卡（任一不过 abort 不迁移）：
#   ① 工作树干净 + HEAD 已推 origin/main（跟 deploy.sh 关① 同一套判断，保证要迁移的
#      migration 文件就是已经进 git、大家能看到的那份，不是本地某次实验性改动）
#   ② npx wrangler d1 migrations apply trip-expense-ledger-db --remote
#
# 这个脚本只负责「迁移前的基线一致性」，不负责「迁移跟 Worker 部署谁先谁后」这个协调
# 问题——round35 记录里提到的「PIN 功能的 migration 还没 apply，但 Worker 代码可能先
# 部署上去导致缺列报错」这类时序问题，仍然要靠人（lifeos-pm/Remy）判断先后，脚本这层
# 只能保证「你现在要跑的这份迁移文件，来源是干净可信的」。
#
# 退出码：0 成功 / 1 前置检查（工作树干净+已推）没过，未迁移 / 2 wrangler 本身跑失败
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || { echo "✘ 进不去 trip-expense-ledger 目录"; exit 1; }

echo "▶ [trip-expense-ledger migrate-remote] ① 工作树干净 + HEAD 已推 origin/main"
# 噪音排除跟 deploy.sh 关① 用同一套约定，保持一致（不是遗漏）：
#   - audit-diffs/  走查截图，长期不进 git
#   - design-references/  设计方案参照截图，跟 audit-diffs 同类，不进 git
#   - *.md          PENDING-DECISIONS 等本地记事本，跟要迁移的 SQL 无关
#   - lib/build-info.ts  prebuild 钩子每次构建自动重写，不代表真实代码改动
#   - trip-expense-ledger-worktrees/  嵌在主 checkout 内部的历史遗留 worktree
#     目录（`git worktree add` 建的隔离环境），本身不是这个仓库要追踪的内容，
#     一直存在，不代表这次要迁移的改动有问题（2026-09-26 第七十一轮补：之前
#     这条只在 deploy.sh 漏了，migrate-remote.sh 从来没排除过，两边本该"同一套
#     约定"却实际不同步，这次一并对齐，见同一轮 deploy.sh 的对应改动）。
DIRTY="$(git status --porcelain -- . ':!audit-diffs' ':!design-references' ':!*.md' ':!lib/build-info.ts' ':!trip-expense-ledger-worktrees')"
if [ -n "$DIRTY" ]; then
  echo "✘ 工作树有未提交改动，不迁移生产 D1（要跑的迁移文件必须先进 git，不能凭工作树现状迁移）："
  echo "$DIRTY"
  exit 1
fi
git fetch origin main --quiet 2>/dev/null
LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_MAIN="$(git rev-parse origin/main 2>/dev/null)"
if [ -z "$REMOTE_MAIN" ]; then
  echo "✘ 拿不到 origin/main（fetch 失败或没网），不迁移"; exit 1
fi
if [ "$LOCAL_HEAD" != "$REMOTE_MAIN" ]; then
  if git merge-base --is-ancestor "$LOCAL_HEAD" "$REMOTE_MAIN" 2>/dev/null; then
    echo "✘ 本地 HEAD 落后 origin/main — 先 git pull origin main 同步再迁移，不迁移"
  else
    echo "✘ 本地 HEAD ($LOCAL_HEAD) 还没推到 origin/main ($REMOTE_MAIN) — 先 git push origin main 再迁移，不迁移"
  fi
  exit 1
fi
echo "✓ 关① 工作树干净，HEAD 已推 origin/main ($LOCAL_HEAD)"

echo "▶ [trip-expense-ledger migrate-remote] ② npx wrangler d1 migrations apply trip-expense-ledger-db --remote"
if ! npx wrangler d1 migrations apply trip-expense-ledger-db --remote; then
  echo "✘ wrangler d1 migrations apply 本身失败（前面闸门已过，是命令本身的问题）"; exit 2
fi

echo "✓ [trip-expense-ledger migrate-remote] 生产 D1 迁移完成"
exit 0
