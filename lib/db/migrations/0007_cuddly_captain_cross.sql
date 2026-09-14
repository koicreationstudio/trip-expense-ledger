CREATE TABLE `trip_payment_method_enabled` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`payment_method_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payment_method_id`) REFERENCES `payment_method`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trip_payment_method_enabled_trip_idx` ON `trip_payment_method_enabled` (`trip_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trip_payment_method_enabled_pair_idx` ON `trip_payment_method_enabled` (`trip_id`,`payment_method_id`);--> statement-breakpoint
-- 回填：这张表是全新的，老数据从来没有过「启用」这个概念，不回填的话所有历史
-- 支付方式在所有行程的过滤视图里都会消失（记账下拉突然空掉、已有钱包绑定的支付
-- 方式突然找不到），这是真实的破坏性回归，必须补一份合理默认值，不是可选步骤。
-- 策略：guest（participant_id 归属）的支付方式只可能属于它自己那一趟行程，直接
-- 对那趟行程启用；账号（user_id 归属）的支付方式可能跨多趟行程复用，对这个账号
-- 名下当前每一趟行程都启用（多趟行程各插一行），保持「老数据默认全部可见」这个
-- 最小破坏性的选择，之后 Remy 要收窄再自己去手动取消勾选。
-- INSERT OR IGNORE + SELECT DISTINCT：账号（user_id）在极少数情况下会在同一趟
-- 行程里出现不止一条 participant 记录（比如既是 owner 又另外认领了一个占位名字），
-- 这时 JOIN 会把同一个 (trip_id, payment_method_id) 对撞出重复行，撞到上面刚建的
-- 唯一索引；guest（participant_id）理论上不会重复，但同样加 DISTINCT 图个保险，
-- 不额外增加风险。
INSERT OR IGNORE INTO `trip_payment_method_enabled` (`id`, `trip_id`, `payment_method_id`)
SELECT lower(hex(randomblob(16))), `p`.`trip_id`, `pm`.`id`
FROM (SELECT DISTINCT `id`, `participant_id` FROM `payment_method` WHERE `participant_id` IS NOT NULL) `pm`
JOIN `participant` `p` ON `p`.`id` = `pm`.`participant_id`;--> statement-breakpoint
INSERT OR IGNORE INTO `trip_payment_method_enabled` (`id`, `trip_id`, `payment_method_id`)
SELECT lower(hex(randomblob(16))), `p`.`trip_id`, `pm`.`id`
FROM (SELECT DISTINCT `id`, `user_id` FROM `payment_method` WHERE `user_id` IS NOT NULL) `pm`
JOIN (SELECT DISTINCT `trip_id`, `user_id` FROM `participant` WHERE `user_id` IS NOT NULL) `p`
  ON `p`.`user_id` = `pm`.`user_id`;