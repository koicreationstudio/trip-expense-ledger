CREATE TABLE `exchange_rate_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`base_currency` text NOT NULL,
	`quote_currency` text NOT NULL,
	`rate` real NOT NULL,
	`fetched_at` integer NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `expense_split` (
	`expense_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`share_amount_base_currency` integer NOT NULL,
	PRIMARY KEY(`expense_id`, `participant_id`),
	FOREIGN KEY (`expense_id`) REFERENCES `expense`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `expense` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`entered_by_participant_id` text NOT NULL,
	`payer_participant_id` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`amount_base_currency` integer NOT NULL,
	`fx_rate_used` real DEFAULT 1 NOT NULL,
	`fx_rate_source` text DEFAULT 'manual' NOT NULL,
	`category` text NOT NULL,
	`note` text,
	`receipt_path` text,
	`expense_date` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entered_by_participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payer_participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `invite` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`code` text NOT NULL,
	`created_by_participant_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `participant` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`display_name` text NOT NULL,
	`is_owner` integer DEFAULT false NOT NULL,
	`claimed_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `payment_method` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`label` text NOT NULL,
	`kind` text NOT NULL,
	`settlement_currency` text NOT NULL,
	`fx_markup_percent` real DEFAULT 0 NOT NULL,
	`foreign_txn_fee_percent` real DEFAULT 0 NOT NULL,
	`fixed_fee` integer DEFAULT 0 NOT NULL,
	`cashback_percent` real DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`last_seen_at` integer,
	FOREIGN KEY (`participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settlement_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`computed_at` integer NOT NULL,
	`base_currency` text NOT NULL,
	`result_json` text NOT NULL,
	`created_by_participant_id` text NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `trip` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_currency` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`owner_participant_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exchange_rate_pair_idx` ON `exchange_rate_cache` (`base_currency`,`quote_currency`);--> statement-breakpoint
CREATE INDEX `expense_split_participant_idx` ON `expense_split` (`participant_id`);--> statement-breakpoint
CREATE INDEX `expense_trip_idx` ON `expense` (`trip_id`);--> statement-breakpoint
CREATE INDEX `expense_entered_by_idx` ON `expense` (`entered_by_participant_id`);--> statement-breakpoint
CREATE INDEX `expense_payer_idx` ON `expense` (`payer_participant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invite_code_idx` ON `invite` (`code`);--> statement-breakpoint
CREATE INDEX `invite_trip_idx` ON `invite` (`trip_id`);--> statement-breakpoint
CREATE INDEX `participant_trip_idx` ON `participant` (`trip_id`);--> statement-breakpoint
CREATE INDEX `payment_method_participant_idx` ON `payment_method` (`participant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_hash_idx` ON `session` (`token_hash`);--> statement-breakpoint
CREATE INDEX `session_participant_idx` ON `session` (`participant_id`);--> statement-breakpoint
CREATE INDEX `settlement_snapshot_trip_idx` ON `settlement_snapshot` (`trip_id`);