-- "结算按币种拆开显示"（2026-09-26）：expense_split.share_amount_original 一次性回填。
--
-- 迁移 0013 给 expense_split 表加了 share_amount_original（默认 0），这次上线前的
-- 历史记录需要一次性回填，不能让所有历史分摊一上线全部变成 0（那样结算页转账清单
-- 拆出来的原始币种数字会全部显示成 0，明显是错的）。
--
-- 回填公式（按 CLAUDE.md 这一轮任务的明确指示，不是这个脚本自己发明的）：
--   shareAmountOriginal = ROUND(shareAmountBaseCurrency / expense.amountBaseCurrency * expense.amount)
-- 这是"用本位币份额占比反推原始币种份额"的比例公式，每一份独立四舍五入，
-- 不是最大余数法——同一笔消费好几份独立四舍五入，总和跟 expense.amount 可能有
-- ±0.01（几分钱量级）的误差，这是已知的、接受的近似，本位币层面（amountBaseCurrency/
-- shareAmountBaseCurrency）完全没被这个回填碰过，"谁最终欠谁多少钱"这个真相不受
-- 影响。新记录（这次上线之后创建的）走的是另一套精确算法（lib/domain/split.ts
-- 的 deriveOriginalCurrencyShares，最大余数法，不丢钱），只有这次上线前的历史
-- 记录才用这个近似公式回填。
--
-- expense.amount_base_currency 理论上不会是 0（消费金额必须是正数，换算成本位币
-- 后正常情况下也是正数），但防御性地排除 = 0 的极端情况（避免除以 0），那批极端
-- 记录的 share_amount_original 保持默认值 0，不强行算一个没有意义的数字。
--
-- 本地验证：`npm run db:migrate:local` 应用过 0013 之后，
-- `wrangler d1 execute trip-expense-ledger-db --local --file=scripts/backfill-expense-split-original-currency.sql`
-- 跑一遍，再抽样 `SELECT es.share_amount_base_currency, es.share_amount_original, e.amount, e.amount_base_currency FROM expense_split es JOIN expense e ON es.expense_id=e.id LIMIT 20` 核对比例算得对不对。
--
-- 生产执行：这个脚本这次只准备好、本地验证过语法没问题，不在这轮直接对 Remy 生产
-- D1 执行——由 lifeos-pm/Remy 决定合适的时机跑
-- `wrangler d1 execute trip-expense-ledger-db --remote --file=scripts/backfill-expense-split-original-currency.sql`
-- （这个仓库的裸 wrangler d1 命令已经被 settings.json deny 锁 + migrate-remote.sh
-- 关卡挡住，真正执行时要走那道关卡，不是直接裸跑）。
--
-- 幂等：可以安全重复执行——每次都是按当前 share_amount_base_currency/amount 重新
-- 算一遍，不依赖上一次跑的结果；但如果这之后已经有新记录用精确算法写入了
-- share_amount_original（非默认值 0），这条 UPDATE 会用近似公式重新覆盖它们，
-- 所以只应该在这次上线、旧记录还没被精确算法碰过之前跑一次，之后不要重复执行。
UPDATE expense_split
SET share_amount_original = (
  SELECT ROUND(CAST(expense_split.share_amount_base_currency AS REAL) * e.amount / e.amount_base_currency)
  FROM expense e
  WHERE e.id = expense_split.expense_id AND e.amount_base_currency != 0
)
WHERE EXISTS (
  SELECT 1 FROM expense e WHERE e.id = expense_split.expense_id AND e.amount_base_currency != 0
);
