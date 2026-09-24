#!/bin/bash
# trip-expense-ledger 部署互斥锁 — 针对性验证（app 名 "trip-expense-ledger" 这条具体锁路径）
#
# 背景：2026-09-24 round44 真实撞见两个进程同时跑 ./deploy.sh，同时写同一份
# .open-next/ 互相踩文件（详见 PENDING-DECISIONS-trip-expense-ledger.md）。deploy.sh
# 已经接入全机通用的 ~/Desktop/Claude/scripts/deploy_mutex_lock.sh，那份通用脚本自己的
# test_deploy_mutex_lock.sh 用随机 app 名 (mutextest_$$) 验证过锁的通用行为（并发互斥/
# 释放重取/死锁清理/mutation 非空壳），但没有专门测过 "trip-expense-ledger" 这个具体
# app 名的锁路径。这份脚本补这一块，落盘成项目常驻资产，方便以后随时重跑复查。
#
# 用法：bash scripts/test_deploy_lock.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source ~/Desktop/Claude/scripts/deploy_mutex_lock.sh

APP="trip-expense-ledger"
LOCK_PATH="/tmp/remy-deploy-${APP}.lock.d"
FAIL=0

echo "── 清理残留锁（如果上次跑挂了留下的）──"
rm -rf "$LOCK_PATH"

echo ""
echo "── ① 并发互斥：两个进程都对 app 名 \"$APP\" 调 deploy_lock_acquire，第二个必须被挡住 ──"
(
  source ~/Desktop/Claude/scripts/deploy_mutex_lock.sh
  deploy_lock_acquire "$APP"
  echo "  A: 拿到锁"
  sleep 6
  deploy_lock_release "$APP"
  echo "  A: 已释放锁"
) &
A_PID=$!
sleep 1

(
  source ~/Desktop/Claude/scripts/deploy_mutex_lock.sh
  DEPLOY_LOCK_MAX_WAIT=3
  if deploy_lock_acquire "$APP"; then
    echo "  B: ✘ 意外拿到了锁（不该发生，A 还在持锁期间内）"
    exit 1
  else
    echo "  B: ✓ 正确在 A 持锁期间等待超时放弃，没有并发闯入"
    exit 0
  fi
) &
B_PID=$!
wait "$B_PID"
B_RC=$?
wait "$A_PID"

if [ "$B_RC" -ne 0 ]; then
  echo "✘ ①失败：B 不应该在 A 持锁期间拿到锁"
  FAIL=1
else
  echo "✓ ①通过：并发互斥生效，\"$APP\" 这个具体 app 名的锁路径确实排他"
fi

echo ""
echo "── ② 死锁清理：第一个进程模拟被杀（不调用 release），下一次 acquire 应侦测死锁并自动清理拿到锁 ──"
rm -rf "$LOCK_PATH"
# 注意：bash (这台机器是 3.2, macOS 默认) 里 \$\$ 在 (...)& 子 shell 里拿到的还是
# 外层脚本自己的 pid，不是子 shell 真正的 fork pid（没有 \$BASHPID 可用来区分）。
# deploy_lock_acquire 内部写的是 \$\$，所以直接跑子 shell 记录到的 pid 会是"外层脚本
# 还活着"的 pid，没法构造出真实死锁场景。这里改用 \$!（job control 真实 pid）在子
# shell 短暂存活期间覆写锁目录里的 pid 文件，再 wait 到它真正退出——这样锁目录里
# 记录的 pid 是"确实存在过、现在真的已经退出"的进程，构成一次真实的死锁场景，
# 不是靠假造一个从没存在过的数字。
(
  source ~/Desktop/Claude/scripts/deploy_mutex_lock.sh
  deploy_lock_acquire "$APP" >/dev/null
  sleep 2
) &
C_JOB_PID=$!
sleep 0.5
if [ -d "$LOCK_PATH" ]; then
  echo "$C_JOB_PID" > "$LOCK_PATH/pid"
  echo "  C: 拿到锁（真实子进程 pid ${C_JOB_PID}，用 \$! 覆写进 pid 文件），即将退出而不调用 release"
fi
wait "$C_JOB_PID" 2>/dev/null
# 保险：确认真的死透了（wait 理论上已经保证，这里再显式核对一次不留侥幸）
WAIT_TRIES=0
while kill -0 "$C_JOB_PID" 2>/dev/null; do
  WAIT_TRIES=$((WAIT_TRIES + 1))
  if [ "$WAIT_TRIES" -ge 20 ]; then break; fi
  sleep 0.2
done
if [ ! -d "$LOCK_PATH" ]; then
  echo "✘ ②前置条件不对：C 退出后锁目录应该还留着（模拟死锁）"
  FAIL=1
else
  HOLDER_PID="$(cat "$LOCK_PATH/pid" 2>/dev/null)"
  echo "  锁目录还在，记录的持锁 pid=${HOLDER_PID}（这个 pid 现在应该已经不存在了）"
  if kill -0 "$HOLDER_PID" 2>/dev/null; then
    echo "✘ ②前置条件不对：持锁 pid 竟然还活着，不构成死锁场景"
    FAIL=1
  else
    echo "  ✓ 持锁 pid 确认已不存在，构成真实死锁场景"
    if deploy_lock_acquire "$APP"; then
      echo "  ✓ D: 下一次 acquire 正确侦测到死锁，自动清理后拿到了锁"
      deploy_lock_release "$APP"
    else
      echo "✘ ②失败：D 应该能侦测死锁自动清理拿到锁，但没有"
      FAIL=1
    fi
  fi
fi

echo ""
rm -rf "$LOCK_PATH"
if [ "$FAIL" -eq 0 ]; then
  echo "✅ trip-expense-ledger 专属锁路径验证全过（并发互斥 + 死锁自动清理）"
  exit 0
else
  echo "❌ trip-expense-ledger 专属锁路径验证有失败项，见上面标 ✘ 的行"
  exit 1
fi
