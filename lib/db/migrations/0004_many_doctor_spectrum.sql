-- 第十六轮登录换血：user 表加 identity_token，email/password_hash 放宽成可空。
-- 同 0003 一样的坑：D1 单批次迁移包在隐式事务里，PRAGMA foreign_keys=OFF 是
-- no-op，DROP TABLE `user` 时只要 participant/payment_method/user_session
-- 还有行引用它的 id 就会被 FK 拦下来。做法跟 0003 一致：先把受影响的引用
-- 备份到临时表 → 清空/删除引用 → 走 drizzle-kit 标准重建表流程 → 按 id 还原
-- （user 的 id 值本身不变，还原值必然合法）→ 删临时表。
-- user_session.user_id 是 NOT NULL，不能像 participant/payment_method 那样
-- 直接置空，改成备份整行、删除、重建后按原样插回。
-- 本机 local D1 dev 数据里实测发现过 1 条 user_session 指向一个根本不存在的
-- user_id（历史遗留脏数据，不是这次迁移造成的），还原时对三张表都加
-- "对应的 user_id 必须真的存在于新 user 表" 这道防线，跳过孤儿行，
-- 不让脏数据把整个迁移炸掉。
CREATE TABLE `_id_backup_participant_user` AS SELECT `id`, `user_id` FROM `participant` WHERE `user_id` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `_id_backup_payment_method_user` AS SELECT `id`, `user_id` FROM `payment_method` WHERE `user_id` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `_id_backup_user_session` AS SELECT `id`, `user_id`, `token_hash`, `user_agent`, `created_at`, `last_seen_at` FROM `user_session`;--> statement-breakpoint
UPDATE `participant` SET `user_id` = NULL WHERE `user_id` IS NOT NULL;--> statement-breakpoint
UPDATE `payment_method` SET `user_id` = NULL WHERE `user_id` IS NOT NULL;--> statement-breakpoint
DELETE FROM `user_session`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`password_hash` text,
	`display_name` text NOT NULL,
	`identity_token` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_user`("id", "email", "password_hash", "display_name", "created_at") SELECT "id", "email", "password_hash", "display_name", "created_at" FROM `user`;--> statement-breakpoint
DROP TABLE `user`;--> statement-breakpoint
ALTER TABLE `__new_user` RENAME TO `user`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_idx` ON `user` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_identity_token_idx` ON `user` (`identity_token`);--> statement-breakpoint
UPDATE `participant` SET `user_id` = (SELECT `user_id` FROM `_id_backup_participant_user` WHERE `_id_backup_participant_user`.`id` = `participant`.`id`) WHERE `participant`.`id` IN (SELECT `id` FROM `_id_backup_participant_user` b WHERE EXISTS (SELECT 1 FROM `user` u WHERE u.id = b.user_id));--> statement-breakpoint
UPDATE `payment_method` SET `user_id` = (SELECT `user_id` FROM `_id_backup_payment_method_user` WHERE `_id_backup_payment_method_user`.`id` = `payment_method`.`id`) WHERE `payment_method`.`id` IN (SELECT `id` FROM `_id_backup_payment_method_user` b WHERE EXISTS (SELECT 1 FROM `user` u WHERE u.id = b.user_id));--> statement-breakpoint
INSERT INTO `user_session` (`id`, `user_id`, `token_hash`, `user_agent`, `created_at`, `last_seen_at`) SELECT `id`, `user_id`, `token_hash`, `user_agent`, `created_at`, `last_seen_at` FROM `_id_backup_user_session` b WHERE EXISTS (SELECT 1 FROM `user` u WHERE u.id = b.user_id);--> statement-breakpoint
DROP TABLE `_id_backup_participant_user`;--> statement-breakpoint
DROP TABLE `_id_backup_payment_method_user`;--> statement-breakpoint
DROP TABLE `_id_backup_user_session`;
