CREATE TABLE `expense_list_filter_preference` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`participant_id` text,
	`trip_id` text NOT NULL,
	`sort_mode` text DEFAULT 'manual' NOT NULL,
	`category_filter` text DEFAULT 'ALL' NOT NULL,
	`payer_filter` text DEFAULT 'ALL' NOT NULL,
	`date_filter` text DEFAULT 'ALL' NOT NULL,
	`payment_method_filter` text DEFAULT 'ALL' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expense_list_filter_preference_user_trip_idx` ON `expense_list_filter_preference` (`user_id`,`trip_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `expense_list_filter_preference_participant_trip_idx` ON `expense_list_filter_preference` (`participant_id`,`trip_id`);--> statement-breakpoint
ALTER TABLE `expense` ADD `sort_order` integer DEFAULT 0 NOT NULL;