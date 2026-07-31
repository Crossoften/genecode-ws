-- Marcadores compostos: MTHFR (C677T + A1298C) e HFE (C282Y + H63D).
--
-- Dois SNPs que só têm significado clínico juntos. A tabela guarda a referência
-- à regra e o peso; a matemática vive no domínio, onde pode ser conferida
-- contra a literatura.
CREATE TABLE `panel_composites` (
  `id` CHAR(36) NOT NULL,
  `panelId` CHAR(36) NOT NULL,
  `categoryId` CHAR(36) NOT NULL,
  `ruleKey` VARCHAR(40) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `weight` DECIMAL(6,4) NOT NULL,
  `position` INTEGER NOT NULL DEFAULT 0,
  UNIQUE INDEX `panel_composites_panelId_ruleKey_key`(`panelId`, `ruleKey`),
  INDEX `panel_composites_categoryId_idx`(`categoryId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `panel_composites` ADD CONSTRAINT `panel_composites_panelId_fkey`
  FOREIGN KEY (`panelId`) REFERENCES `panels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `panel_composites` ADD CONSTRAINT `panel_composites_categoryId_fkey`
  FOREIGN KEY (`categoryId`) REFERENCES `panel_categories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
