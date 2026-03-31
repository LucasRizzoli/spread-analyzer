ALTER TABLE `spread_analysis` ADD `dataVencimento` varchar(16);--> statement-breakpoint
ALTER TABLE `spread_analysis` ADD `spreadIncentivadoSemGrossUp` decimal(10,6);--> statement-breakpoint
CREATE INDEX `idx_spread_cetip_data` ON `spread_analysis` (`codigoCetip`,`dataReferencia`);--> statement-breakpoint
CREATE INDEX `idx_spread_data_ref` ON `spread_analysis` (`dataReferencia`);