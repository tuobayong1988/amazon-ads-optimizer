CREATE TABLE `dayparting_budget_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`strategyId` int NOT NULL,
	`dayOfWeek` int NOT NULL,
	`budgetMultiplier` decimal(3,2) DEFAULT '1.00',
	`budgetPercentage` decimal(5,2),
	`avgSpend` decimal(10,2),
	`avgSales` decimal(10,2),
	`avgAcos` decimal(5,2),
	`avgRoas` decimal(10,2),
	`dataPoints` int DEFAULT 0,
	`isEnabled` boolean DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dayparting_budget_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dayparting_execution_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`strategyId` int NOT NULL,
	`executionType` enum('budget_adjustment','bid_adjustment','analysis') NOT NULL,
	`dpTargetType` enum('campaign','adgroup','keyword'),
	`dpTargetId` int,
	`dpTargetName` varchar(500),
	`previousValue` decimal(10,2),
	`newValue` decimal(10,2),
	`multiplierApplied` decimal(3,2),
	`triggerDayOfWeek` int,
	`triggerHour` int,
	`dpExecStatus` enum('success','failed','skipped') DEFAULT 'success',
	`dpErrorMessage` text,
	`executedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dayparting_execution_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dayparting_strategies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`accountId` int NOT NULL,
	`campaignId` int,
	`name` varchar(255) NOT NULL,
	`description` text,
	`strategyType` enum('budget','bidding','both') DEFAULT 'both',
	`daypartingOptGoal` enum('maximize_sales','target_acos','target_roas','minimize_acos') DEFAULT 'maximize_sales',
	`daypartingTargetAcos` decimal(5,2),
	`daypartingTargetRoas` decimal(10,2),
	`analysisLookbackDays` int DEFAULT 30,
	`minDataPoints` int DEFAULT 10,
	`maxBudgetMultiplier` decimal(3,2) DEFAULT '2.00',
	`minBudgetMultiplier` decimal(3,2) DEFAULT '0.20',
	`maxBidMultiplier` decimal(3,2) DEFAULT '2.00',
	`minBidMultiplier` decimal(3,2) DEFAULT '0.20',
	`daypartingStatus` enum('active','paused','draft') DEFAULT 'draft',
	`lastAnalyzedAt` timestamp,
	`lastAppliedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dayparting_strategies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `hourly_performance` (
	`id` int AUTO_INCREMENT NOT NULL,
	`accountId` int NOT NULL,
	`campaignId` int NOT NULL,
	`adGroupId` int,
	`keywordId` int,
	`date` timestamp NOT NULL,
	`hour` int NOT NULL,
	`dayOfWeek` int NOT NULL,
	`impressions` int DEFAULT 0,
	`clicks` int DEFAULT 0,
	`spend` decimal(10,2) DEFAULT '0.00',
	`sales` decimal(10,2) DEFAULT '0.00',
	`orders` int DEFAULT 0,
	`hourlyAcos` decimal(5,2),
	`hourlyRoas` decimal(10,2),
	`hourlyCtr` decimal(5,4),
	`hourlyCvr` decimal(5,4),
	`hourlyCpc` decimal(10,2),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `hourly_performance_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `hourparting_bid_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`strategyId` int NOT NULL,
	`dayOfWeek` int NOT NULL,
	`hour` int NOT NULL,
	`bidMultiplier` decimal(3,2) DEFAULT '1.00',
	`avgClicks` decimal(10,2),
	`hourAvgSpend` decimal(10,2),
	`hourAvgSales` decimal(10,2),
	`hourAvgCvr` decimal(5,4),
	`hourAvgCpc` decimal(10,2),
	`hourAvgAcos` decimal(5,2),
	`hourDataPoints` int DEFAULT 0,
	`hourIsEnabled` boolean DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `hourparting_bid_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `campaigns` ADD `dailyBudget` decimal(10,2);