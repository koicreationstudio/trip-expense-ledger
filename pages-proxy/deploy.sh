#!/bin/bash
# kongsi-trip.pages.dev 转发层部署关卡 —— 不准直接 `wrangler pages deploy`。
# 这个项目本身只有一个文件在做真事（functions/[[path]].js，把请求原样转给
# trip-expense-ledger Worker），但照全机规矩，凡是会推东西上线的部署都要走
# 自己的 deploy.sh，不准裸推。
#
# 关卡（任一不过 abort 不部署）：
#   ① git 工作树干净（scoped 到 pages-proxy/ 这个子目录）+ HEAD 已推 origin/main
#   ② 语法检查（node --check functions/[[path]].js）
#   ③ 转发冒烟测试守护（node --test，测的是"转发函数逻辑有没有被改坏"——假
#      env.ORIGIN.fetch 探针断言：只调用一次 / 传进去的是原始 request 对象本身
#      不是重新拼的 / 返回值就是 fetch 的返回值本身不被改写。mutation 验证记录：
#      手动跑过三种坏版本[不调用fetch / 重新new Request而非透传 / 吞掉返回值自造
#      Response]，三次都真的让测试变红，改回原版全绿，证明不是空壳，过程见
#      pages-proxy/tests/forward.test.mjs 顶部注释）
#      这一步测的是"转发函数本身的代码逻辑"，不是"线上真的转发成功"——线上是
#      否真通全靠下面④打真实网络验证，两层职责不重叠：③挡的是代码回归（比如
#      以后有人手滑把这个文件改坏），④挡的是环境/配置层面的问题（比如
#      service binding 配错名字、origin worker 挂了）。
#   ④ npx wrangler pages deploy public --project-name kongsi-trip
#   ⑤ 回读本次部署输出的直连 URL（不是 apex kongsi-trip.pages.dev —— apex 走
#      的是生产分支别名，边缘缓存传播有延迟，直连 URL 才能立刻验证这次部署
#      有没有真的生效，不会被"其实还没生效但恰好读到旧缓存"骗过）打
#      /api/health，这个请求会一路转发到 trip-expense-ledger Worker 自己的
#      /api/health（真的查一次 D1 `SELECT 1`），200 + {"ok":true} 才算过关。
#
# 退出码：0 成功 / 1 前置检查（①干净树+已推 / ②语法 / ③冒烟测试）没过，未部署
#         / 2 已部署但回读没验证到（可能配置有问题，也可能只是边缘传播慢，
#         过几秒手动 curl 直连 URL 再确认一次）
#
# ⚠️ 已知坑（2026-09-25 建这个项目当场踩到，记录清楚免得以后又当新 bug 来查）：
#   `wrangler pages deploy` 在这种"仓库根目录有自己的 wrangler.jsonc（Worker 本体
#   trip-expense-ledger 的配置），pages-proxy/ 子目录又有自己独立 wrangler.toml"
#   的结构下，有个已知开源 bug（cloudflare/workers-sdk#5711）：它会往上找到仓库根
#   目录那份 wrangler.jsonc，发现里面没有 pages_build_output_dir，就判定"这不是
#   Pages 配置"，直接整个忽略掉——包括忽略掉本来就该用的 pages-proxy/wrangler.toml
#   里的 `[[services]]` binding 声明。Pages 不支持 `--config` 指定路径绕开（会报
#   "Pages does not support custom paths for the Wrangler configuration file"）。
#   实测现象：deploy 本身会成功，但转发函数运行时 `context.env.ORIGIN` 是
#   undefined，打任何请求都是 Cloudflare error 1101（Worker 抛异常）。
#   **已经修好的部分**：service binding 现在是直接调 Cloudflare API
#   （`PATCH /accounts/{id}/pages/projects/kongsi-trip`，`deployment_configs.
#   production.services.ORIGIN`）一次性设到项目本身的配置上，不是靠 wrangler.toml
#   在部署时下发的——这层配置是项目级、常驻的，不会被"没读到 wrangler.toml"的
#   普通部署清空或覆盖，所以往后正常跑这份 deploy.sh 不会把 binding 弄丢，不用
#   每次部署都重新调一次 API。pages-proxy/wrangler.toml 还留着（内容是对的，
#   将来 wrangler 修掉这个上游 bug 之后应该就能正常生效），当文档用，不影响现状。
#   **如果以后要整个重建这个 Pages 项目**（比如误删了、换账号）：`wrangler pages
#   project create kongsi-trip` 建完项目之后，光跑这份 deploy.sh 是不够的，还要
#   重新执行一次上面说的 Cloudflare API PATCH（或者去 Cloudflare 网页后台
#   kongsi-trip 项目 → Settings → Bindings 手动加 Service binding：变量名
#   `ORIGIN`，指向 Worker `trip-expense-ledger`），不然④会成功但⑤回读会
#   500，报错信息会是转发本身"看起来通了"但打不到真的 Worker。
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT" || { echo "✘ 进不去 pages-proxy 目录"; exit 1; }
REPO_ROOT="$(cd "$ROOT/.." && pwd)"

echo "▶ [kongsi-trip deploy] ① 工作树干净（scoped pages-proxy/）+ HEAD 已推 origin/main"
cd "$REPO_ROOT" || { echo "✘ 进不去仓库根目录"; exit 1; }
DIRTY="$(git status --porcelain -- pages-proxy)"
if [ -n "$DIRTY" ]; then
  echo "✘ pages-proxy/ 有未提交改动，不部署（要上生产的代码必须先进 git）："
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
cd "$ROOT" || exit 1

echo "▶ [kongsi-trip deploy] ② 语法检查"
if ! node --check "functions/[[path]].js"; then
  echo "✘ 语法检查不过，不部署"; exit 1
fi
echo "✓ 关② 语法检查通过"

echo "▶ [kongsi-trip deploy] ③ 转发冒烟测试守护"
if ! npm test; then
  echo "✘ 转发冒烟测试不过，不部署"; exit 1
fi
echo "✓ 关③ 转发冒烟测试通过"

echo "▶ [kongsi-trip deploy] ④ npx wrangler pages deploy public --project-name kongsi-trip"
DEPLOY_OUTPUT="$(npx wrangler pages deploy public --project-name kongsi-trip 2>&1)"
WRANGLER_RC=$?
echo "$DEPLOY_OUTPUT"
if [ "$WRANGLER_RC" -ne 0 ]; then
  echo "✘ wrangler pages deploy 失败（前面守卫已过，是部署本身的问题）"; exit 2
fi

DEPLOY_URL="$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[a-zA-Z0-9.-]+\.kongsi-trip\.pages\.dev' | head -1)"
if [ -z "$DEPLOY_URL" ]; then
  # 兜底：有些 wrangler 版本输出格式不同，退而求其次抓任意 *.pages.dev 直连 URL
  DEPLOY_URL="$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[a-zA-Z0-9.-]+\.pages\.dev' | grep -v '^https://kongsi-trip\.pages\.dev$' | head -1)"
fi
if [ -z "$DEPLOY_URL" ]; then
  echo "⚠️ 部署输出里没解析到直连 URL，回读改用 apex https://kongsi-trip.pages.dev（可能受边缘传播延迟影响）"
  DEPLOY_URL="https://kongsi-trip.pages.dev"
fi

echo "▶ [kongsi-trip deploy] ⑤ 回读 $DEPLOY_URL/api/health（经转发层打到 trip-expense-ledger 的真实健康检查）"
# 每次新部署的直连 URL 都是一个全新的唯一子域名（比如 a5dcf0d4.kongsi-trip.pages.dev），
# 实测过第一次 curl 常常还没传播完（404），几秒后就通——单次 curl 判定太容易假阳性
# 报失败，改成重试 6 次、每次间隔 5 秒（实测跑过一次真实部署，2-3 次之内必通）。
HEALTH_STATUS="curl_failed"
HEALTH_BODY=""
for attempt in 1 2 3 4 5 6; do
  HEALTH_STATUS="$(curl -s -o /dev/null -w '%{http_code}' "$DEPLOY_URL/api/health" --max-time 15 || echo 'curl_failed')"
  if [ "${HEALTH_STATUS:-}" = "200" ]; then
    HEALTH_BODY="$(curl -s "$DEPLOY_URL/api/health" --max-time 15)"
    break
  fi
  echo "  回读第 $attempt 次拿到 [$HEALTH_STATUS]，不是 200，等 5 秒再试"
  sleep 5
done
if [ "${HEALTH_STATUS:-}" != "200" ]; then
  echo "✘ 部署成功但 /api/health 回读重试 6 次仍拿不到 200（最后一次是 [$HEALTH_STATUS]），可能是 service binding 配置有问题，不只是边缘传播慢——去查 pages-proxy/CLAUDE.md「一个已知坑」那节"
  exit 2
fi
echo "回读响应体：$HEALTH_BODY"
if [[ "$HEALTH_BODY" != *'"ok":true'* ]]; then
  echo "✘ /api/health 回读到 200 但响应体不是预期的 {\"ok\":true}（$HEALTH_BODY）—— 转发本身可能没问题，但打到的不是真的 trip-expense-ledger health handler，需要人工核实"
  exit 2
fi

echo "✓ [kongsi-trip deploy] 部署完成，$DEPLOY_URL 回读 /api/health 200 {\"ok\":true}（转发链路 Pages→service binding→trip-expense-ledger Worker→D1 全通）"
exit 0
