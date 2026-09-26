-- round74：loan/loan_repayment 接入结算净额计算，需要固化本位币金额（跟
-- expense.amountBaseCurrency 同一套架构）+ loan_repayment 支持"不挂具体
-- loan"的还款（loanId 改可空 + 新增 fromParticipantId/toParticipantId/
-- currency 字段）。
--
-- 手动调整点（drizzle-kit 原始生成产物在这两处会直接跑不动，已手动修正，
-- 不是照抄生成结果）：
-- ①`loan` 表新增 `amount_base_currency` 手动补了 `DEFAULT 0`——SQLite
--   对已有数据的表 ADD COLUMN NOT NULL 时，没有 DEFAULT 会直接报错拒绝
--   执行，不是"用 NULL 顶一下"这么宽松。0 只是让 ALTER 语句本身能跑通的
--   临时占位值，真实的历史数据数值（比如已迁移的 US$7,500 那笔）由这次
--   迁移之后单独的 backfill 脚本用精确值覆盖，不依赖这个默认值。
-- ②`loan` 的这三个 ADD COLUMN 语句挪到了 loan_repayment 表重建之前——
--   下面重建 loan_repayment 时，INSERT...SELECT 需要 JOIN `loan` 表读
--   `fx_rate_used`/`fx_rate_source` 反推历史还款记录的新字段，这几列必须
--   先存在才能被读到，顺序颠倒会报 "no such column"。
ALTER TABLE `loan` ADD `amount_base_currency` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `loan` ADD `fx_rate_used` real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `loan` ADD `fx_rate_source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_loan_repayment` (
	`id` text PRIMARY KEY NOT NULL,
	`loan_id` text,
	`from_participant_id` text NOT NULL,
	`to_participant_id` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`amount_base_currency` integer NOT NULL,
	`fx_rate_used` real DEFAULT 1 NOT NULL,
	`fx_rate_source` text DEFAULT 'manual' NOT NULL,
	`to_wallet_id` text,
	`date` integer NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`loan_id`) REFERENCES `loan`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_wallet_id`) REFERENCES `wallet`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
-- 手动修正（drizzle-kit 生成的原始 INSERT 是直接照抄新列名去老表选，但老表
-- 压根没有 from_participant_id/to_participant_id/currency/amount_base_currency
-- 这几列，会报 "no such column" 直接失败）：existing 的 loan_repayment 行全部
-- 挂着 loan_id（round74 之前没有"不挂具体借款"的还款），方向永远是"这笔 loan
-- 的 borrower 还给 lender"，currency/汇率跟对应 loan 一致——backfill 直接从
-- 关联的 loan 表 join 出这几个新列，不是瞎猜的默认值。
INSERT INTO `__new_loan_repayment`("id", "loan_id", "from_participant_id", "to_participant_id", "amount", "currency", "amount_base_currency", "fx_rate_used", "fx_rate_source", "to_wallet_id", "date", "note", "created_at")
SELECT lr."id", lr."loan_id", l."borrower_participant_id", l."lender_participant_id", lr."amount", l."currency",
       CAST(ROUND(lr."amount" * l."fx_rate_used") AS INTEGER), l."fx_rate_used", l."fx_rate_source",
       lr."to_wallet_id", lr."date", lr."note", lr."created_at"
FROM `loan_repayment` lr JOIN `loan` l ON l."id" = lr."loan_id";--> statement-breakpoint
DROP TABLE `loan_repayment`;--> statement-breakpoint
ALTER TABLE `__new_loan_repayment` RENAME TO `loan_repayment`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `loan_repayment_loan_idx` ON `loan_repayment` (`loan_id`);--> statement-breakpoint
CREATE INDEX `loan_repayment_to_wallet_idx` ON `loan_repayment` (`to_wallet_id`);--> statement-breakpoint
CREATE INDEX `loan_repayment_from_participant_idx` ON `loan_repayment` (`from_participant_id`);--> statement-breakpoint
CREATE INDEX `loan_repayment_to_participant_idx` ON `loan_repayment` (`to_participant_id`);
