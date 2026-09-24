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
#   [拿部署互斥锁，从这里开始一直到脚本结束都在锁里 — 2026-09-24 round44 真实撞见
#    两个进程同时跑 ./deploy.sh，同时写同一份 .open-next/ 互相踩文件，导致一次 build
#    ENOENT 失败。复用全机通用的 ~/Desktop/Claude/scripts/deploy_mutex_lock.sh（10 条
#    部署管线在用的同一套 mkdir 原子锁 + 死锁自动清理），锁的范围比其它项目更宽：
#    其它项目大多只包 wrangler 那一行，这个项目是 build 步骤本身会撞车，所以从 ⑤ build
#    包到 ⑦ 回读结束]
#   ⑤ opennextjs-cloudflare build（内部触发 next build，打出 Worker 产物）
#   ⑥ npx wrangler deploy
#   ⑦ 回读部署后的 URL 打 /api/health 确认 200
#
# ⚠️ 手动必跑（不在关卡里，要打真实网络、跑几分钟，不适合每次部署都卡）：改了
#   app/my-trips.tsx / app/invite/[code]/claim-form.tsx / wallet-grid.tsx /
#   payment-methods/** / trip-header-nav.tsx / 任何 session、cookie、跳转相关代码，
#   部署后用专属测试账号跑一遍（绝不能用 Remy 真实身份链接）：
#     E2E_IDENTITY_URL=... E2E_TRIP_NAME=... npm run test:e2e:wallet-deeplink
#     E2E_IDENTITY_URL=... E2E_TRIP_NAME=... E2E_LOGIN_CLICK=eager npm run test:e2e:wallet-deeplink
#     E2E_IDENTITY_URL=... E2E_TRIP_NAME=... npm run test:e2e:expandable-reset
#   钱包深链被报"已修复"推翻过 4 次，就是因为以前只凭点一两次下结论。详见 CLAUDE.md
#   「手动 e2e 回归探针」和 PENDING-DECISIONS 第六十四轮。
#
# 退出码：0 成功 / 1 前置检查（① 干净树+已推 / lint/typecheck/test/build / 互斥锁没拿到）
#         没过，未部署 / 2 wrangler deploy 本身失败 / 3 部署成功但回读没打到 200
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT" || { echo "✘ 进不去 trip-expense-ledger 目录"; exit 1; }

echo "▶ [trip-expense-ledger deploy] ① 工作树干净 + HEAD 已推 origin/main"
# 噪音排除（跟 scripts/generate-build-info.mjs 自己的 dirty-check 用同一套约定，
# 保持一致）：
#   - audit-diffs/  走查截图，这个项目长期不进 git，约定如此不是遗漏
#   - design-references/  设计方案参照截图（Remy 反馈截图/Artifact mockup 存本地
#                    给 ui-auditor 比对用），跟 audit-diffs 同类，不进 git
#   - *.md          PENDING-DECISIONS-trip-expense-ledger.md 等本地记事本，设计
#                    上就是「写完不进 git」，跟部署的代码是否等于 HEAD 无关
#   - lib/build-info.ts  prebuild 钩子每次构建自动重写，不代表真实代码改动
DIRTY="$(git status --porcelain -- . ':!audit-diffs' ':!design-references' ':!*.md' ':!lib/build-info.ts')"
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

echo "▶ [trip-expense-ledger deploy] 部署互斥锁 mutation 自检（防这套机制被后续改动悄悄削弱成空壳，每次真实部署都重新验一遍，不需要单独排期常驻任务）"
if ! bash ~/Desktop/Claude/scripts/test_deploy_mutex_lock.sh >/dev/null; then
  echo "✘ 部署互斥锁 mutation 自检失败（空壳），不部署"; exit 1
fi

echo "▶ [trip-expense-ledger deploy] 拿部署互斥锁（覆盖 build→wrangler deploy→回读整段，2026-09-24 round44 真实撞过一次 .open-next/ 互踩，全机通用锁见 ~/Desktop/Claude/scripts/deploy_mutex_lock.sh）"
source ~/Desktop/Claude/scripts/deploy_mutex_lock.sh
if ! deploy_lock_acquire "trip-expense-ledger"; then
  echo "✘ 拿不到部署互斥锁（另一个进程可能正卡着），不部署"; exit 1
fi
trap 'deploy_lock_release "trip-expense-ledger"' EXIT
echo "✓ 已拿到 trip-expense-ledger 部署互斥锁"

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
