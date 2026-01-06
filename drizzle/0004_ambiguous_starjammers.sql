CREATE TABLE `notification_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`accountId` int,
	`type` enum('alert','report','system') NOT NULL,
	`severity` enum('info','warning','critical') DEFAULT 'info',
	`title` varchar(255) NOT NULL,
	`message` text NOT NULL,
	`channel` enum('email','in_app','both') DEFAULT 'in_app',
	`status` enum('pending','sent','failed','read') DEFAULT 'pending',
	`relatedEntityType` varchar(64),
	`relatedEntityId` int,
	`sentAt` timestamp,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notification_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notification_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`accountId` int,
	`emailEnabled` boolean DEFAULT true,
	`inAppEnabled` boolean DEFAULT true,
	`acosThreshold` decimal(5,2) DEFAULT '50.00',
	`ctrDropThreshold` decimal(5,2) DEFAULT '30.00',
	`conversionDropThreshold` decimal(5,2) DEFAULT '30.00',
	`spendSpikeThreshold` decimal(5,2) DEFAULT '50.00',
	`frequency` enum('immediate','hourly','daily','weekly') DEFAULT 'daily',
	`quietHoursStart` int DEFAULT 22,
	`quietHoursEnd` int DEFAULT 8,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `notification_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scheduled_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`accountId` int,
	`taskType` enum('ngram_analysis','funnel_migration','traffic_conflict','smart_bidding','health_check','data_sync') NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`enabled` boolean DEFAULT true,
	`schedule` enum('hourly','daily','weekly','monthly') DEFAULT 'daily',
	`runTime` varchar(8) DEFAULT '06:00',
	`dayOfWeek` int,
	`dayOfMonth` int,
	`parameters` text,
	`lastRunAt` timestamp,
	`lastRunStatus` enum('success','failed','running','skipped'),
	`lastRunResult` text,
	`nextRunAt` timestamp,
	`autoApply` boolean DEFAULT false,
	`requireApproval` boolean DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scheduled_tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `task_execution_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskId` int NOT NULL,
	`userId` int NOT NULL,
	`accountId` int,
	`taskType` varchar(64) NOT NULL,
	`status` enum('running','success','failed','cancelled') NOT NULL,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	`duration` int,
	`itemsProcessed` int DEFAULT 0,
	`suggestionsGenerated` int DEFAULT 0,
	`suggestionsApplied` int DEFAULT 0,
	`errorMessage` text,
	`resultSummary` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `task_execution_log_id` PRIMARY KEY(`id`)
);
