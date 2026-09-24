CREATE TABLE `fx_compare_preference` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`participant_id` text,
	`trip_id` text NOT NULL,
	`hold_currency` text NOT NULL,
	`target_currency` text NOT NULL,
	`enabled_compare_keys` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fx_compare_preference_user_trip_idx` ON `fx_compare_preference` (`user_id`,`trip_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `fx_compare_preference_participant_trip_idx` ON `fx_compare_preference` (`participant_id`,`trip_id`);