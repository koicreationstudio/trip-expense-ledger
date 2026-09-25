-- 第七十一轮任务⑤：expense.sort_order 一次性回填。
--
-- 迁移 0012 给 expense 表加了 sort_order（默认 0），这次要在上线时把已有的历史
-- 消费按"现在没有手动排序时列表展示的实际顺序"回填一遍——不能让所有历史消费
-- 一上线全部变成 sort_order=0，那样用户第一次切进"手动排序"模式会看到顺序
-- 突然乱掉，不是"回填出一个能接着用的起点"。
--
-- 回填基准：app/trips/[tripId]/page.tsx 第 67-71 行现有的 tripExpenses 查询用
-- `.orderBy(desc(expenses.expenseDate))`——这是这次上线前用户已经在看的默认
-- 顺序，回填就照这个顺序赋值（同一天多笔用 created_at 降序做二级排序，保证
-- 结果稳定、不依赖 SQLite 的隐式行序）。sort_order 数字越小排越前（跟
-- reorder API 的下标语义一致），所以这里排在"最新"的那一条给最小的号
-- （0），越旧的号越大——回填之后如果什么都不切换，直接看"手动排序"
-- 结果应该跟回填前的默认展示顺序一模一样。
--
-- 按 trip_id 分组编号（PARTITION BY），不是全表一个序列——不同行程的顺序互不
-- 影响，这也跟 reorder API"重排结果按整趟行程共享"的设计一致。
--
-- 本地验证：`npm run db:migrate:local` 应用过 0012 之后，
-- `wrangler d1 execute trip-expense-ledger-db --local --file=scripts/backfill-expense-sort-order.sql`
-- 跑一遍，再 `SELECT trip_id, id, expense_date, sort_order FROM expense ORDER BY trip_id, sort_order`
-- 确认每趟行程内 sort_order 严格递增、且顺序跟 expense_date 降序一致。
--
-- 生产执行：这个脚本这次只准备好、本地验证过，不在这轮直接对 Remy 生产 D1 执行——
-- 由 lifeos-pm/Remy 决定合适的时机跑
-- `wrangler d1 execute trip-expense-ledger-db --remote --file=scripts/backfill-expense-sort-order.sql`。
-- 幂等：可以安全重复执行（每次都是按当前 expense_date 重新算一遍绝对名次，
-- 不依赖上一次跑的结果），不会因为跑第二次而把已经手动拖拽调整过的顺序打乱——
-- 但也正因为"幂等 = 会覆盖手动调整过的顺序"，只应该在这次上线时跑一次，
-- 之后不要再对已经有人用过手动排序的行程重复执行。
UPDATE expense
SET sort_order = (
  SELECT ranked.rn - 1
  FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY trip_id ORDER BY expense_date DESC, created_at DESC) AS rn
    FROM expense
  ) ranked
  WHERE ranked.id = expense.id
);
