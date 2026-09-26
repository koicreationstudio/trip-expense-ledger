-- "结算按币种拆开显示"（2026-09-26）：settlement_confirmation.currency 一次性回填。
--
-- 背景：迁移 0013 给 settlement_confirmation 加了 currency 列（可空），这次上线前
-- 已经存在的确认行是按旧规则"整个 (trip_id, from, to) 只有一个确认状态"记的，
-- 那时候压根没有"这笔到底是哪个币种"这个概念，这一列对它们来说是 NULL。
--
-- 这份脚本做的事（具体怎么处理是这次任务里明确说"不用我自己在产品语义上拍板"的
-- 一点，写清楚给 Remy/PM 核对，不是自己判断"这样处理对不对"）：
--   对每一条 currency IS NULL 的历史确认行 (trip_id, from, to)，按"迁移这一刻"
--   这对参与者在这趟行程里实际涉及哪些币种（用跟 lib/domain/settlement.ts
--   computeNetBalances 完全一致的净值定义：某个币种下 from 净值<0 且 to 净值>0，
--   就认定这笔历史确认覆盖了这个币种），为每个匹配到的币种各插入一行新的确认记录
--   （confirmedAt 沿用原行的时间戳），然后删掉原来那行 NULL 记录。
--   如果一个历史确认行在"迁移这一刻"已经找不到任何匹配的币种（比如账目后来被
--   编辑过，这笔债务已经不存在了），就只删掉这行 NULL 记录，不产生任何新行——
--   没有东西需要保留，这笔钱本来就已经不欠了。
--
-- 这个做法不是"什么都不做（旧确认全部变成看起来没收）"，也不是"全部币种都标成
-- 已收款（包括这次迁移之后才新增的币种，那样会错误隐藏还没收到的钱）"——是把
-- 历史状态"物化"成迁移那一刻能确定的具体事实，迁移之后新增的币种不会被这批
-- 历史行自动覆盖（不会有对应的新行）。这个判断是否符合 Remy 想要的产品语义，
-- 由 PM/Remy 核对，不在这里自己拍板。
--
-- 现状核对（2026-09-26 只读查询过生产库）：目前生产 settlement_confirmation 表
-- 一行记录都没有（`SELECT COUNT(*) FROM settlement_confirmation` = 0），也就是说
-- 这份脚本现在对生产数据实际是空操作——写好是为了这次改动的完整性和"以后哪天真的
-- 有历史确认行时不用再现推一遍逻辑"，不代表现在跑了会看到任何变化。
--
-- 本地验证：本地测试 D1 插入几行合成的 currency IS NULL 记录后跑这份脚本，确认能
-- 正确展开成对应币种的新行 + 删掉旧行，也确认"迁移那一刻已经没有对应债务"的历史
-- 行会被干净地删除、不产生垃圾新行（见 scripts/backfill-settlement-confirmation-
-- currency.test.ts）。
--
-- 生产执行：这个脚本这次只准备好、本地验证过，不在这轮直接对 Remy 生产 D1
-- 执行——由 lifeos-pm/Remy 决定合适的时机跑
-- `wrangler d1 execute trip-expense-ledger-db --remote --file=scripts/backfill-settlement-confirmation-currency.sql`。
--
-- 幂等：新行落在 (trip_id, from, to, currency) 唯一索引上，重复跑不会插出重复行
-- （第二次跑时 legacy 表已经是空的，因为上一次跑已经把 NULL 行全部处理掉了，
-- INSERT 部分自然不会有任何行）。
INSERT INTO settlement_confirmation (id, trip_id, from_participant_id, to_participant_id, currency, confirmed_at)
SELECT
  lower(hex(randomblob(16))),
  legacy.trip_id,
  legacy.from_participant_id,
  legacy.to_participant_id,
  net_from.currency,
  legacy.confirmed_at
FROM (
  SELECT id, trip_id, from_participant_id, to_participant_id, confirmed_at
  FROM settlement_confirmation
  WHERE currency IS NULL
) AS legacy
JOIN (
  SELECT
    e.trip_id,
    e.currency,
    p.id AS participant_id,
    COALESCE(SUM(CASE WHEN e.payer_participant_id = p.id THEN e.amount_base_currency ELSE 0 END), 0)
      - COALESCE((
          SELECT SUM(es.share_amount_base_currency)
          FROM expense_split es
          JOIN expense e2 ON es.expense_id = e2.id
          WHERE e2.trip_id = e.trip_id AND e2.currency = e.currency AND es.participant_id = p.id
        ), 0) AS net_amount
  FROM expense e
  JOIN participant p ON p.trip_id = e.trip_id
  GROUP BY e.trip_id, e.currency, p.id
) AS net_from
  ON net_from.trip_id = legacy.trip_id
  AND net_from.participant_id = legacy.from_participant_id
  AND net_from.net_amount < 0
JOIN (
  SELECT
    e.trip_id,
    e.currency,
    p.id AS participant_id,
    COALESCE(SUM(CASE WHEN e.payer_participant_id = p.id THEN e.amount_base_currency ELSE 0 END), 0)
      - COALESCE((
          SELECT SUM(es.share_amount_base_currency)
          FROM expense_split es
          JOIN expense e2 ON es.expense_id = e2.id
          WHERE e2.trip_id = e.trip_id AND e2.currency = e.currency AND es.participant_id = p.id
        ), 0) AS net_amount
  FROM expense e
  JOIN participant p ON p.trip_id = e.trip_id
  GROUP BY e.trip_id, e.currency, p.id
) AS net_to
  ON net_to.trip_id = legacy.trip_id
  AND net_to.currency = net_from.currency
  AND net_to.participant_id = legacy.to_participant_id
  AND net_to.net_amount > 0;

DELETE FROM settlement_confirmation WHERE currency IS NULL;
