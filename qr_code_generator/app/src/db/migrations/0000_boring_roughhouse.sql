CREATE TABLE `scan_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	`scanned_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`user_agent` text,
	`ip_address` text
);
--> statement-breakpoint
CREATE INDEX `scan_events_token_scanned_at_idx` ON `scan_events` (`token`,`scanned_at`);--> statement-breakpoint
CREATE TABLE `url_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	`original_url` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `url_mappings_token_unique` ON `url_mappings` (`token`);