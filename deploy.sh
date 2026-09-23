#!/bin/bash
# trip-expense-ledger 部署关卡 — 不准直接 `wrangler deploy`（settings.json 已
# deny 裸 wrangler deploy，全机凡是带 D1/R2 等真实状态的 Worker 都走这条规矩，
# 见 remy-api/deploy.sh），强制走这个脚本。
#
# 关卡（任一不过 abort 不部署）：
#   ① 工作树干净 + HEAD 已推 origin/main（2026-09-23 事故补：找回功能代码被部署到
#      生产、D1 schema 被改动，都发生在对应 commit 之前 — 部署的是工作树现状，不是
#      HEAD 那个 commit。照搬 calculator/deploy.sh、thailand-app/deploy.sh 已验证过
#      的「部署基线」思路，适配成这个项目自己的结构）
#   ② lint  ③ typecheck  ④ 单测 全过
#   ⑤ opennextjs-cloudflare build（内部触发 next build，打出 Worker 产物）
#   ⑥ npx wrangler deploy
#   ⑦ 回读部署后的 URL 打 /api/health 确认 200
#
# 退出码：0 成功 / 1 前置检查（① 干净树+已推 / lint/typecheck/test/build）没过，未部署 /
#         2 wrangler deploy 本身失败 / 3 部署成功但回读没打到 200
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT" || { echo "✘ 进不去 trip-expense-ledger 目录"; exit 1; }

echo "▶ [trip-expense-ledger deploy] ① 工作树干净 + HEAD 已推 origin/main"
# 噪音排除（跟 scripts/generate-build-info.mjs 自己的 dirty-check 用同一套约定，
# 保持一致）：
#   - audit-diffs/  走查截图，这个项目长期不进 git，约定如此不是遗漏
#   - *.md          PENDING-DECISIONS-trip-expense-ledger.md 等本地记事本，设计
#                    上就是「写完不进 git」，跟部署的代码是否等于 HEAD 无关
#   - lib/build-info.ts  prebuild 钩子每次构建自动重写，不代表真实代码改动
DIRTY="$(git status --porcelain -- . ':!audit-diffs' ':!*.md' ':!lib/build-info.ts')"
if [ -n "$DIRTY" ]; then
  echo "✘ 工作树有未提交改动，不部署（要上生产的代码必须先进 git，不能凭工作树现状部署）："
  echo "$DIRTY"
  exit 1
fi
git fetch origin main --quiet 2>/dev/null
LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_MAIN="$(git rev-parse origin/main 2>/dev/null)"
if [ -z "$REMOTE_MAIN" ]; then
  echo "✘ 拿不到 origin/main（fetch 失败或没网），不部署"; exit 1
fi
if [ "$LOCAL_HEAD" != "$REMOTE_MAIN" ]; then
  if git merge-base --is-ancestor "$LOCAL_HEAD" "$REMOTE_MAIN" 2>/dev/null; then
    echo "✘ 本地 HEAD 落后 origin/main — 先 git pull origin main 同步再部署，不部署"
  else
    echo "✘ 本地 HEAD ($LOCAL_HEAD) 还没推到 origin/main ($REMOTE_MAIN) — 先 git push origin main 再部署，不部署"
  fi
  exit 1
fi
echo "✓ 关① 工作树干净，HEAD 已推 origin/main ($LOCAL_HEAD)"

echo "▶ [trip-expense-ledger deploy] ② lint"
if ! npm run lint; then
  echo "✘ lint 不过，不部署"; exit 1
fi

echo "▶ [trip-expense-ledger deploy] ③ typecheck"
if ! npm run typecheck; then
  echo "✘ typecheck 不过，不部署"; exit 1
fi

echo "▶ [trip-expense-ledger deploy] ④ 单测"
if ! npm test; then
  echo "✘ 单测不过，不部署"; exit 1
fi

echo "▶ [trip-expense-ledger deploy] ⑤ opennextjs-cloudflare build（内部会跑 next build）"
if ! npx opennextjs-cloudflare build; then
  echo "✘ OpenNext Cloudflare 构建失败，不部署"; exit 1
fi

echo "▶ [trip-expense-ledger deploy] ⑥ npx wrangler deploy"
DEPLOY_OUTPUT="$(npx wrangler deploy 2>&1)"
WRANGLER_RC=$?
echo "$DEPLOY_OUTPUT"
if [ "$WRANGLER_RC" -ne 0 ]; then
  echo "✘ wrangler deploy 失败（前面守卫已过，是部署本身的问题）"; exit 2
fi

DEPLOY_URL="$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -1)"
if [ -z "$DEPLOY_URL" ]; then
  echo "⚠️ 部署输出里没解析到 *.workers.dev URL，跳过回读（部署本身已成功）"
  echo "✓ [trip-expense-ledger deploy] 部署完成（回读跳过）"
  exit 0
fi

echo "▶ [trip-expense-ledger deploy] ⑦ 回读 $DEPLOY_URL/api/health"
HEALTH_STATUS="$(curl -s -o /dev/null -w '%{http_code}' "$DEPLOY_URL/api/health" --max-time 15 || echo 'curl_failed')"
if [ "${HEALTH_STATUS:-}" != "200" ]; then
  echo "✘ 部署成功但 /api/health 回读拿到 [$HEALTH_STATUS]（不是 200），可能是刚部署边缘还没传播完，稍等几秒手动再 curl 一次确认"
  exit 3
fi

echo "✓ [trip-expense-ledger deploy] 部署完成，$DEPLOY_URL 回读 /api/health 200"
exit 0
