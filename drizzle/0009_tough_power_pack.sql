CREATE TABLE `comparable_searches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`query` text NOT NULL,
	`attributes` json,
	`searchTerms` json,
	`status` enum('pending','running','done','error') NOT NULL DEFAULT 'pending',
	`results` json,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `comparable_searches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_comparable_user` ON `comparable_searches` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_comparable_status` ON `comparable_searches` (`status`);--> statement-breakpoint
CREATE INDEX `idx_comparable_created` ON `comparable_searches` (`createdAt`);