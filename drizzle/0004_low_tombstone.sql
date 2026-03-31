CREATE TABLE `historical_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`snapshotAt` datetime NOT NULL,
	`dataRefIni` varchar(16) NOT NULL,
	`dataRefFim` varchar(16) NOT NULL,
	`rating` varchar(20) NOT NULL,
	`nPapeis` int NOT NULL,
	`mediaSpread` decimal(10,4),
	`medianaSpread` decimal(10,4),
	`p25Spread` decimal(10,4),
	`p75Spread` decimal(10,4),
	`stdSpread` decimal(10,4),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `historical_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `sync_log` ADD `dataReferencia` varchar(16);--> statement-breakpoint
ALTER TABLE `sync_log` ADD `papeisNaJanela` int;--> statement-breakpoint
ALTER TABLE `sync_log` ADD `snapshotId` int;--> statement-breakpoint
ALTER TABLE `sync_log` ADD `alertas` json;--> statement-breakpoint
CREATE INDEX `idx_snapshot_at_rating` ON `historical_snapshots` (`snapshotAt`,`rating`);--> statement-breakpoint
CREATE INDEX `idx_snapshot_rating` ON `historical_snapshots` (`rating`);