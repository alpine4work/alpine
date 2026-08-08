PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_usage_windows` (
	`account_id` text NOT NULL,
	`type` text NOT NULL,
	`started_time` integer NOT NULL,
	`was_model_downgraded` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`account_id`, `type`)
);
--> statement-breakpoint
INSERT INTO `__new_agent_usage_windows`("account_id", "type", "started_time", "was_model_downgraded") SELECT "account_id", "Dynamic", "started_time", false FROM `agent_usage_windows`;--> statement-breakpoint
DROP TABLE `agent_usage_windows`;--> statement-breakpoint
ALTER TABLE `__new_agent_usage_windows` RENAME TO `agent_usage_windows`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
