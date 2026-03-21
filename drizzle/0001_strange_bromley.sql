CREATE TABLE `anbima_assets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`codigoCetip` varchar(16) NOT NULL,
	`isin` varchar(32),
	`tipo` enum('DEB','CRI','CRA') NOT NULL,
	`emissorNome` varchar(256),
	`emissorCnpj` varchar(20),
	`setor` varchar(128),
	`numeroEmissao` varchar(16),
	`numeroSerie` varchar(16),
	`dataEmissao` varchar(16),
	`dataVencimento` varchar(16),
	`remuneracao` varchar(128),
	`indexador` varchar(32),
	`incentivado` boolean DEFAULT false,
	`taxaIndicativa` decimal(10,6),
	`taxaCompra` decimal(10,6),
	`taxaVenda` decimal(10,6),
	`durationDias` int,
	`durationAnos` decimal(8,4),
	`dataReferencia` varchar(16),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `anbima_assets_id` PRIMARY KEY(`id`),
	CONSTRAINT `anbima_assets_codigoCetip_unique` UNIQUE(`codigoCetip`)
);
--> statement-breakpoint
CREATE TABLE `moodys_ratings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`setor` varchar(128),
	`emissor` varchar(256) NOT NULL,
	`produto` varchar(128),
	`instrumento` varchar(256),
	`objeto` varchar(512),
	`rating` varchar(32) NOT NULL,
	`perspectiva` varchar(64),
	`dataAtualizacao` varchar(32),
	`numeroEmissao` varchar(16),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `moodys_ratings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ntnb_curve` (
	`id` int AUTO_INCREMENT NOT NULL,
	`dataReferencia` varchar(16) NOT NULL,
	`codigoCetip` varchar(16) NOT NULL,
	`vencimento` varchar(16),
	`taxaIndicativa` decimal(10,6),
	`durationAnos` decimal(8,4),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ntnb_curve_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `spread_analysis` (
	`id` int AUTO_INCREMENT NOT NULL,
	`codigoCetip` varchar(16) NOT NULL,
	`isin` varchar(32),
	`tipo` enum('DEB','CRI','CRA'),
	`emissorNome` varchar(256),
	`setor` varchar(128),
	`indexador` varchar(32),
	`incentivado` boolean DEFAULT false,
	`rating` varchar(32),
	`tipoMatch` enum('emissao','emissor','sem_match') DEFAULT 'sem_match',
	`moodysRatingId` int,
	`taxaIndicativa` decimal(10,6),
	`durationAnos` decimal(8,4),
	`dataReferencia` varchar(16),
	`ntnbReferencia` varchar(16),
	`ntnbTaxa` decimal(10,6),
	`ntnbDuration` decimal(8,4),
	`zspread` decimal(10,6),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `spread_analysis_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sync_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tipo` varchar(64) NOT NULL,
	`status` enum('running','success','error') NOT NULL,
	`mensagem` text,
	`totalProcessados` int DEFAULT 0,
	`totalErros` int DEFAULT 0,
	`iniciadoEm` timestamp NOT NULL DEFAULT (now()),
	`finalizadoEm` timestamp,
	CONSTRAINT `sync_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_anbima_isin` ON `anbima_assets` (`isin`);--> statement-breakpoint
CREATE INDEX `idx_anbima_emissor` ON `anbima_assets` (`emissorNome`);--> statement-breakpoint
CREATE INDEX `idx_anbima_tipo` ON `anbima_assets` (`tipo`);--> statement-breakpoint
CREATE INDEX `idx_moodys_emissor` ON `moodys_ratings` (`emissor`);--> statement-breakpoint
CREATE INDEX `idx_spread_cetip` ON `spread_analysis` (`codigoCetip`);--> statement-breakpoint
CREATE INDEX `idx_spread_rating` ON `spread_analysis` (`rating`);--> statement-breakpoint
CREATE INDEX `idx_spread_tipo` ON `spread_analysis` (`tipo`);--> statement-breakpoint
CREATE INDEX `idx_spread_indexador` ON `spread_analysis` (`indexador`);