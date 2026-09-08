-- D1 在单个 execute 批次里把整份迁移文件包在一个隐式事务里，事务内切换
-- PRAGMA foreign_keys 是 SQLite 的已知空操作（no-op），并不会真的关闭 FK
-- 强制检查。所以 DROP TABLE payment_method 时，只要 wallet/expense 还有
-- 行引用它的 id，DROP 就会被 FK 约束拦下来（实测验证过：光加
-- PRAGMA foreign_keys=OFF 挡不住，必须先把引用列置空）。
-- 做法：先把 wallet/expense 里非空的 payment_method_id 存进临时表，
-- 置空原列 → 走 drizzle-kit 生成的标准重建表流程 → 用临时表按 id 全部
-- 还原（id 保持不变，还原值必然合法）→ 删临时表。
CREATE TABLE `_pm_backup_wallet` AS SELECT `id`, `payment_method_id` FROM `wallet` WHERE `payment_method_id` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `_pm_backup_expense` AS SELECT `id`, `payment_method_id` FROM `expense` WHERE `payment_method_id` IS NOT NULL;--> statement-breakpoint
UPDATE `wallet` SET `payment_method_id` = NULL WHERE `payment_method_id` IS NOT NULL;--> statement-breakpoint
UPDATE `expense` SET `payment_method_id` = NULL WHERE `payment_method_id` IS NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_payment_method` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`participant_id` text,
	`label` text NOT NULL,
	`kind` text NOT NULL,
	`settlement_currency` text NOT NULL,
	`fx_markup_percent` real DEFAULT 0 NOT NULL,
	`foreign_txn_fee_percent` real DEFAULT 0 NOT NULL,
	`fixed_fee` integer DEFAULT 0 NOT NULL,
	`cashback_percent` real DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_payment_method`("id", "participant_id", "label", "kind", "settlement_currency", "fx_markup_percent", "foreign_txn_fee_percent", "fixed_fee", "cashback_percent", "is_active", "sort_order") SELECT "id", "participant_id", "label", "kind", "settlement_currency", "fx_markup_percent", "foreign_txn_fee_percent", "fixed_fee", "cashback_percent", "is_active", "sort_order" FROM `payment_method`;--> statement-breakpoint
DROP TABLE `payment_method`;--> statement-breakpoint
ALTER TABLE `__new_payment_method` RENAME TO `payment_method`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `payment_method_user_idx` ON `payment_method` (`user_id`);--> statement-breakpoint
CREATE INDEX `payment_method_participant_idx` ON `payment_method` (`participant_id`);--> statement-breakpoint
UPDATE `wallet` SET `payment_method_id` = (SELECT `payment_method_id` FROM `_pm_backup_wallet` WHERE `_pm_backup_wallet`.`id` = `wallet`.`id`) WHERE `wallet`.`id` IN (SELECT `id` FROM `_pm_backup_wallet`);--> statement-breakpoint
UPDATE `expense` SET `payment_method_id` = (SELECT `payment_method_id` FROM `_pm_backup_expense` WHERE `_pm_backup_expense`.`id` = `expense`.`id`) WHERE `expense`.`id` IN (SELECT `id` FROM `_pm_backup_expense`);--> statement-breakpoint
DROP TABLE `_pm_backup_wallet`;--> statement-breakpoint
DROP TABLE `_pm_backup_expense`;--> statement-breakpoint
-- 回填：有账号的人(userId 非空)把已有支付方式的归属从 participant_id 挪到
-- user_id，往后跨行程终身可见；guest(participant.userId 为空)保持原状不动。
UPDATE `payment_method` SET `user_id` = (SELECT `user_id` FROM `participant` WHERE `participant`.`id` = `payment_method`.`participant_id`) WHERE `user_id` IS NULL AND `participant_id` IN (SELECT `id` FROM `participant` WHERE `user_id` IS NOT NULL);
