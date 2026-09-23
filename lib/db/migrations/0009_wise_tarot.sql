CREATE TABLE `recovery_attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`ip_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `recovery_attempt_ip_hash_idx` ON `recovery_attempt` (`ip_hash`);--> statement-breakpoint
ALTER TABLE `user` ADD `recovery_pin_hash` text;--> statement-breakpoint
ALTER TABLE `user` ADD `recovery_pin_set_at` integer;