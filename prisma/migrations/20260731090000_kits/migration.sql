-- Kits e lotes.
CREATE TABLE `kit_batches` (
  `id` CHAR(36) NOT NULL, `reference` VARCHAR(40) NOT NULL, `notes` VARCHAR(255) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `kit_batches_reference_key`(`reference`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `kits` (
  `id` CHAR(36) NOT NULL, `code` VARCHAR(12) NOT NULL, `batchId` CHAR(36) NOT NULL,
  `status` ENUM('GENERATED','ASSIGNED','ACTIVATED','SAMPLE_SENT','SAMPLE_RECEIVED','DISCARDED') NOT NULL DEFAULT 'GENERATED',
  `orderId` CHAR(36) NULL, `subjectId` CHAR(36) NULL, `activatedByUserId` CHAR(36) NULL,
  `activatedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `kits_code_key`(`code`), INDEX `kits_status_idx`(`status`),
  INDEX `kits_orderId_idx`(`orderId`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `kits` ADD CONSTRAINT `kits_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `kit_batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
