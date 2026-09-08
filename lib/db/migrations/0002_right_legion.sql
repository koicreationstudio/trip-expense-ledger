CREATE TABLE `exchange_record` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`from_wallet_id` text,
	`to_wallet_id` text NOT NULL,
	`from_amount` integer,
	`to_amount` integer NOT NULL,
	`exchange_date` integer NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_wallet_id`) REFERENCES `wallet`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`to_wallet_id`) REFERENCES `wallet`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exchange_record_trip_idx` ON `exchange_record` (`trip_id`);--> statement-breakpoint
CREATE INDEX `exchange_record_participant_idx` ON `exchange_record` (`participant_id`);--> statement-breakpoint
CREATE TABLE `wallet` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`label` text NOT NULL,
	`currency` text NOT NULL,
	`emoji` text DEFAULT '💰' NOT NULL,
	`current_balance` integer DEFAULT 0 NOT NULL,
	`payment_method_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payment_method_id`) REFERENCES `payment_method`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `wallet_trip_idx` ON `wallet` (`trip_id`);--> statement-breakpoint
CREATE INDEX `wallet_participant_idx` ON `wallet` (`participant_id`);--> statement-breakpoint
ALTER TABLE `expense` ADD `payment_method_id` text REFERENCES payment_method(id);