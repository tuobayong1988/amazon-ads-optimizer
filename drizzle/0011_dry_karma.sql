CREATE TABLE `data_sync_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`accountId` int NOT NULL,
	`syncType` enum('campaigns','keywords','performance','all') DEFAULT 'all',
	`status` enum('pending','running','completed','failed','cancelled') DEFAULT 'pending',
	`recordsSynced` int DEFAULT 0,
	`errorMessage` text,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `data_sync_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `data_sync_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobId` int NOT NULL,
	`operation` varchar(100) NOT NULL,
	`status` enum('success','error','warning') DEFAULT 'success',
	`message` text,
	`details` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `data_sync_logs_id` PRIMARY KEY(`id`)
);
