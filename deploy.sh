#!/bin/bash
# trip-expense-ledger 部署关卡 — 不准直接 `wrangler deploy`（settings.json 已
# deny 裸 wrangler deploy，全机凡是带 D1/R2 等真实状态的 Worker 都走这条规矩，
# 见 remy-api/deploy.sh），强制走这个脚本。
#
# 关卡（任一不过 abort 不部署）：
#   ① lint / typecheck / test 全过
#   ② next build（经 opennextjs-cloudflare build 触发）
#   ③ opennextjs-cloudflare build 打出 Worker 产物
#   ④ npx wrangler deploy
#   ⑤ 回读部署后的 URL 打 /api/health 确认 200
#
# 退出码：0 成功 / 1 前置检查（lint/typecheck/test/build）没过，未部署 /
#         2 wrangler deploy 本身失败 / 3 部署成功但回读没打到 200
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT" || { echo "✘ 进不去 trip-expense-ledger 目录"; exit 1; }

echo "▶ [trip-expense-ledger deploy] ① lint"
if ! npm run lint; then
  echo "✘ lint 不过，不部署"; exit 1
fi

echo "▶ [trip-expense-ledger deploy] ② typecheck"
if ! npm run typecheck; then
  echo "✘ typecheck 不过，不部署"; exit 1
fi

echo "▶ [trip-expense-ledger deploy] ③ 单测"
if ! npm test; then
  echo "✘ 单测不过，不部署"; exit 1
fi

echo "▶ [trip-expense-ledger deploy] ④ opennextjs-cloudflare build（内部会跑 next build）"
if ! npx opennextjs-cloudflare build; then
  echo "✘ OpenNext Cloudflare 构建失败，不部署"; exit 1
fi

echo "▶ [trip-expense-ledger deploy] ⑤ npx wrangler deploy"
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

echo "▶ [trip-expense-ledger deploy] ⑥ 回读 $DEPLOY_URL/api/health"
HEALTH_STATUS="$(curl -s -o /dev/null -w '%{http_code}' "$DEPLOY_URL/api/health" --max-time 15 || echo 'curl_failed')"
if [ "${HEALTH_STATUS:-}" != "200" ]; then
  echo "✘ 部署成功但 /api/health 回读拿到 [$HEALTH_STATUS]（不是 200），可能是刚部署边缘还没传播完，稍等几秒手动再 curl 一次确认"
  exit 3
fi

echo "✓ [trip-expense-ledger deploy] 部署完成，$DEPLOY_URL 回读 /api/health 200"
exit 0
