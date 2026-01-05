CREATE TABLE `amazon_api_credentials` (
	`id` int AUTO_INCREMENT NOT NULL,
	`accountId` int NOT NULL,
	`clientId` varchar(255) NOT NULL,
	`clientSecret` varchar(255) NOT NULL,
	`refreshToken` text NOT NULL,
	`accessToken` text,
	`tokenExpiresAt` timestamp,
	`profileId` varchar(64) NOT NULL,
	`region` enum('NA','EU','FE') NOT NULL DEFAULT 'NA',
	`lastSyncAt` timestamp,
	`syncStatus` enum('idle','syncing','error') DEFAULT 'idle',
	`syncErrorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `amazon_api_credentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `amazon_api_credentials_accountId_unique` UNIQUE(`accountId`)
);
