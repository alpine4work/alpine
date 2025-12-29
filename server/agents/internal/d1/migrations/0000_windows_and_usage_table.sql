CREATE TABLE `agent_requests` (
	`account_id` text NOT NULL,
	`space_id` text NOT NULL,
	`trace_id` text NOT NULL,
	`span_id` text NOT NULL,
	`created_time` integer NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`used_millicents` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`account_id`, `space_id`, `created_time`)
);
--> statement-breakpoint
CREATE TABLE `agent_usage_windows` (
	`account_id` text PRIMARY KEY NOT NULL,
	`started_time` integer NOT NULL
);
