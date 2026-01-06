CREATE TABLE `sync_schedules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`account_id` int NOT NULL,
	`sync_type` enum('campaigns','keywords','performance','all') DEFAULT 'all',
	`frequency` enum('hourly','daily','weekly','monthly') NOT NULL,
	`hour` int DEFAULT 0,
	`day_of_week` int,
	`day_of_month` int,
	`is_enabled` boolean DEFAULT true,
	`last_run_at` timestamp,
	`next_run_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sync_schedules_id` PRIMARY KEY(`id`)
);
