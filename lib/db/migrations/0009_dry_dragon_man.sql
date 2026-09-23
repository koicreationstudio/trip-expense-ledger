CREATE TABLE `recovery_pin_attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`client_key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `recovery_pin_attempt_client_key_idx` ON `recovery_pin_attempt` (`client_key`);--> statement-breakpoint
ALTER TABLE `user` ADD `recovery_pin_hash` text;--> statement-breakpoint
ALTER TABLE `user` ADD `recovery_pin_set_at` integer;