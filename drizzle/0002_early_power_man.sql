ALTER TABLE `spread_analysis` ADD `scoreMatch` decimal(5,4);--> statement-breakpoint
ALTER TABLE `spread_analysis` ADD `isOutlier` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `spread_analysis` ADD `emissorMoodys` varchar(256);--> statement-breakpoint
ALTER TABLE `spread_analysis` ADD `numeroEmissaoSnd` int;--> statement-breakpoint
ALTER TABLE `spread_analysis` ADD `numeroEmissaoMoodys` varchar(16);--> statement-breakpoint
ALTER TABLE `spread_analysis` ADD `instrumentoMoodys` varchar(256);