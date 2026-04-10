DROP INDEX `idx_spread_cetip_data` ON `spread_analysis`;--> statement-breakpoint
ALTER TABLE `spread_analysis` ADD CONSTRAINT `uq_spread_cetip_data` UNIQUE(`codigoCetip`,`dataReferencia`);