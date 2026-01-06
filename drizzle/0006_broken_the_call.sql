ALTER TABLE `ad_accounts` ADD `storeName` varchar(255);--> statement-breakpoint
ALTER TABLE `ad_accounts` ADD `storeDescription` text;--> statement-breakpoint
ALTER TABLE `ad_accounts` ADD `storeColor` varchar(7);--> statement-breakpoint
ALTER TABLE `ad_accounts` ADD `marketplaceId` varchar(32);--> statement-breakpoint
ALTER TABLE `ad_accounts` ADD `sellerId` varchar(64);--> statement-breakpoint
ALTER TABLE `ad_accounts` ADD `connectionStatus` enum('connected','disconnected','error','pending') DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `ad_accounts` ADD `lastConnectionCheck` timestamp;--> statement-breakpoint
ALTER TABLE `ad_accounts` ADD `connectionErrorMessage` text;--> statement-breakpoint
ALTER TABLE `ad_accounts` ADD `isDefault` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `ad_accounts` ADD `sortOrder` int DEFAULT 0;