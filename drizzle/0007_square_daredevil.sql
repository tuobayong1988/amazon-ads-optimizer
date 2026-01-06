CREATE TABLE `account_permissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`teamMemberId` int NOT NULL,
	`accountId` int NOT NULL,
	`permissionLevel` enum('full','edit','view') NOT NULL DEFAULT 'view',
	`canExport` boolean DEFAULT true,
	`canManageCampaigns` boolean DEFAULT false,
	`canAdjustBids` boolean DEFAULT false,
	`canManageNegatives` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `account_permissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `email_report_subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`reportType` enum('cross_account_summary','account_performance','campaign_performance','keyword_performance','health_alert','optimization_summary') NOT NULL,
	`frequency` enum('daily','weekly','monthly') NOT NULL DEFAULT 'weekly',
	`sendTime` varchar(5) DEFAULT '09:00',
	`sendDayOfWeek` int,
	`sendDayOfMonth` int,
	`timezone` varchar(64) DEFAULT 'Asia/Shanghai',
	`recipients` json,
	`ccRecipients` json,
	`accountIds` json,
	`includeCharts` boolean DEFAULT true,
	`includeDetails` boolean DEFAULT true,
	`dateRange` enum('last_7_days','last_14_days','last_30_days','last_month','custom') DEFAULT 'last_7_days',
	`isActive` boolean DEFAULT true,
	`lastSentAt` timestamp,
	`nextSendAt` timestamp,
	`sendCount` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `email_report_subscriptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `email_send_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`subscriptionId` int NOT NULL,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	`recipients` json,
	`status` enum('sent','failed','partial') NOT NULL,
	`errorMessage` text,
	`reportData` json,
	`emailSubject` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `email_send_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `team_members` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`memberId` int,
	`email` varchar(320) NOT NULL,
	`name` varchar(255),
	`role` enum('admin','editor','viewer') NOT NULL DEFAULT 'viewer',
	`status` enum('pending','active','inactive','revoked') NOT NULL DEFAULT 'pending',
	`inviteToken` varchar(64),
	`inviteExpiresAt` timestamp,
	`acceptedAt` timestamp,
	`lastActiveAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `team_members_id` PRIMARY KEY(`id`)
);
