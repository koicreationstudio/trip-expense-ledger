CREATE TABLE `loan_repayment` (
	`id` text PRIMARY KEY NOT NULL,
	`loan_id` text NOT NULL,
	`amount` integer NOT NULL,
	`to_wallet_id` text,
	`date` integer NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`loan_id`) REFERENCES `loan`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_wallet_id`) REFERENCES `wallet`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `loan_repayment_loan_idx` ON `loan_repayment` (`loan_id`);--> statement-breakpoint
CREATE INDEX `loan_repayment_to_wallet_idx` ON `loan_repayment` (`to_wallet_id`);--> statement-breakpoint
CREATE TABLE `loan` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`lender_participant_id` text NOT NULL,
	`borrower_participant_id` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`from_wallet_id` text,
	`date` integer NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lender_participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`borrower_participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_wallet_id`) REFERENCES `wallet`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `loan_trip_idx` ON `loan` (`trip_id`);--> statement-breakpoint
CREATE INDEX `loan_lender_idx` ON `loan` (`lender_participant_id`);--> statement-breakpoint
CREATE INDEX `loan_borrower_idx` ON `loan` (`borrower_participant_id`);--> statement-breakpoint
CREATE INDEX `loan_from_wallet_idx` ON `loan` (`from_wallet_id`);--> statement-breakpoint
CREATE TABLE `wallet_balance_history` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_id` text NOT NULL,
	`amount` integer NOT NULL,
	`effective_date` integer NOT NULL,
	`changed_by_participant_id` text NOT NULL,
	`changed_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`prev_amount` integer,
	`prev_effective_date` integer,
	`display_balance_before` integer NOT NULL,
	`display_balance_after` integer NOT NULL,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallet`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`changed_by_participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `wallet_balance_history_wallet_idx` ON `wallet_balance_history` (`wallet_id`);--> statement-breakpoint
DROP INDEX `settlement_confirmation_pair_idx`;--> statement-breakpoint
ALTER TABLE `settlement_confirmation` ADD `currency` text;--> statement-breakpoint
CREATE UNIQUE INDEX `settlement_confirmation_pair_idx` ON `settlement_confirmation` (`trip_id`,`from_participant_id`,`to_participant_id`,`currency`);--> statement-breakpoint
ALTER TABLE `expense_split` ADD `share_amount_original` integer DEFAULT 0 NOT NULL;