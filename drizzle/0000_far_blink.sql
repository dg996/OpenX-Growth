CREATE TABLE `analytics_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`post_id` text NOT NULL,
	`recorded_at` integer NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`likes` integer DEFAULT 0 NOT NULL,
	`replies` integer DEFAULT 0 NOT NULL,
	`reposts` integer DEFAULT 0 NOT NULL,
	`bookmarks` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analytics_post_recorded_idx` ON `analytics_snapshots` (`post_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `api_usage` (
	`day` text PRIMARY KEY NOT NULL,
	`reads` integer DEFAULT 0 NOT NULL,
	`writes` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`vote` integer NOT NULL,
	`context_json` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `feedback_target_idx` ON `feedback` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`thread_json` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`scheduled_at` integer,
	`published_at` integer,
	`x_post_id` text,
	`published_ids_json` text,
	`topic` text,
	`format` text DEFAULT 'post' NOT NULL,
	`hook` text,
	`generated` integer DEFAULT false NOT NULL,
	`evergreen` integer DEFAULT false NOT NULL,
	`evergreen_interval_days` integer DEFAULT 30 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `posts_status_scheduled_idx` ON `posts` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `secure_store` (
	`key` text PRIMARY KEY NOT NULL,
	`sealed_value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
