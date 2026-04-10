CREATE TABLE `uploaded_files` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tipo` enum('moodys','anbima') NOT NULL,
	`nomeArquivo` varchar(256) NOT NULL,
	`dataReferencia` varchar(16),
	`s3Key` varchar(512) NOT NULL,
	`s3Url` text NOT NULL,
	`tamanhoBytes` int,
	`uploadadoEm` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `uploaded_files_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_uploaded_tipo` ON `uploaded_files` (`tipo`);--> statement-breakpoint
CREATE INDEX `idx_uploaded_data_ref` ON `uploaded_files` (`dataReferencia`);