CREATE TABLE `settlement_confirmation` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`from_participant_id` text NOT NULL,
	`to_participant_id` text NOT NULL,
	`confirmed_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `settlement_confirmation_trip_idx` ON `settlement_confirmation` (`trip_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `settlement_confirmation_pair_idx` ON `settlement_confirmation` (`trip_id`,`from_participant_id`,`to_participant_id`);--> statement-breakpoint
ALTER TABLE `invite` ADD `invitee_name` text;--> statement-breakpoint
ALTER TABLE `trip` ADD `trip_start_date` integer;--> statement-breakpoint
ALTER TABLE `trip` ADD `trip_end_date` integer;--> statement-breakpoint
ALTER TABLE `trip` ADD `enabled_currencies` text;--> statement-breakpoint
ALTER TABLE `wallet` ADD `balance_updated_at` integer;