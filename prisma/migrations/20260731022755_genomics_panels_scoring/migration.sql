-- CreateTable
CREATE TABLE `snps` (
    `id` CHAR(36) NOT NULL,
    `rsId` VARCHAR(32) NOT NULL,
    `gene` VARCHAR(32) NOT NULL,
    `fullName` VARCHAR(160) NULL,
    `minorAllele` VARCHAR(8) NULL,
    `minorAlleleFreq` DECIMAL(8, 6) NULL,
    `majorAllele` VARCHAR(8) NULL,
    `majorAlleleFreq` DECIMAL(8, 6) NULL,
    `proteinAction` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `snps_rsId_key`(`rsId`),
    INDEX `snps_gene_idx`(`gene`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `genotype_aliases` (
    `id` CHAR(36) NOT NULL,
    `snpId` CHAR(36) NOT NULL,
    `alias` VARCHAR(24) NOT NULL,
    `canonical` VARCHAR(24) NOT NULL,

    UNIQUE INDEX `genotype_aliases_snpId_alias_key`(`snpId`, `alias`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `panels` (
    `id` CHAR(36) NOT NULL,
    `slug` VARCHAR(64) NOT NULL,
    `version` VARCHAR(20) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `kind` ENUM('PERFORMANCE', 'NUTRIGENETICS') NOT NULL,
    `scoringModel` ENUM('ADDITIVE', 'MULTIPLICATIVE') NOT NULL,
    `status` ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `publishedAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `panels_status_idx`(`status`),
    UNIQUE INDEX `panels_slug_version_key`(`slug`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `panel_categories` (
    `id` CHAR(36) NOT NULL,
    `panelId` CHAR(36) NOT NULL,
    `slug` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `panel_categories_panelId_slug_key`(`panelId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `panel_snps` (
    `id` CHAR(36) NOT NULL,
    `panelId` CHAR(36) NOT NULL,
    `snpId` CHAR(36) NOT NULL,
    `categoryId` CHAR(36) NOT NULL,
    `weight` DECIMAL(6, 4) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,

    INDEX `panel_snps_categoryId_idx`(`categoryId`),
    UNIQUE INDEX `panel_snps_panelId_snpId_key`(`panelId`, `snpId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `genotype_scores` (
    `id` CHAR(36) NOT NULL,
    `panelSnpId` CHAR(36) NOT NULL,
    `genotype` VARCHAR(24) NOT NULL,
    `score` DECIMAL(6, 2) NOT NULL,
    `classification` ENUM('FAVORAVEL', 'MODERADO', 'DESFAVORAVEL') NOT NULL,

    UNIQUE INDEX `genotype_scores_panelSnpId_genotype_key`(`panelSnpId`, `genotype`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `modalities` (
    `id` CHAR(36) NOT NULL,
    `panelId` CHAR(36) NOT NULL,
    `slug` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `isGlobal` BOOLEAN NOT NULL DEFAULT false,
    `position` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `modalities_panelId_slug_key`(`panelId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `modality_weights` (
    `id` CHAR(36) NOT NULL,
    `modalityId` CHAR(36) NOT NULL,
    `categoryId` CHAR(36) NOT NULL,
    `weight` DECIMAL(6, 4) NOT NULL,

    UNIQUE INDEX `modality_weights_modalityId_categoryId_key`(`modalityId`, `categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `percentile_points` (
    `id` CHAR(36) NOT NULL,
    `categoryId` CHAR(36) NULL,
    `modalityId` CHAR(36) NULL,
    `rawScore` DECIMAL(8, 4) NOT NULL,
    `percentile` DECIMAL(8, 4) NOT NULL,

    INDEX `percentile_points_categoryId_rawScore_idx`(`categoryId`, `rawScore`),
    INDEX `percentile_points_modalityId_rawScore_idx`(`modalityId`, `rawScore`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `interpretations` (
    `id` CHAR(36) NOT NULL,
    `panelId` CHAR(36) NOT NULL,
    `rsId` VARCHAR(32) NOT NULL,
    `genotype` VARCHAR(24) NOT NULL,
    `genotypeFreq` DECIMAL(10, 8) NULL,
    `summary` TEXT NULL,
    `patientText` LONGTEXT NOT NULL,
    `references` LONGTEXT NULL,

    UNIQUE INDEX `interpretations_panelId_rsId_genotype_key`(`panelId`, `rsId`, `genotype`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `genotype_batches` (
    `id` CHAR(36) NOT NULL,
    `filename` VARCHAR(255) NOT NULL,
    `uploadedById` CHAR(36) NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `rowCount` INTEGER NOT NULL DEFAULT 0,
    `processedCount` INTEGER NOT NULL DEFAULT 0,
    `failedCount` INTEGER NOT NULL DEFAULT 0,
    `errors` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    INDEX `genotype_batches_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subject_genotypes` (
    `id` CHAR(36) NOT NULL,
    `subjectId` CHAR(36) NOT NULL,
    `snpId` CHAR(36) NOT NULL,
    `rawValue` VARCHAR(24) NOT NULL,
    `genotype` VARCHAR(24) NOT NULL,
    `batchId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `subject_genotypes_snpId_idx`(`snpId`),
    UNIQUE INDEX `subject_genotypes_subjectId_snpId_key`(`subjectId`, `snpId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reports` (
    `id` CHAR(36) NOT NULL,
    `subjectId` CHAR(36) NOT NULL,
    `panelId` CHAR(36) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('DRAFT', 'PUBLISHED', 'SUPERSEDED') NOT NULL DEFAULT 'DRAFT',
    `missingMarkers` JSON NULL,
    `computedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `publishedAt` DATETIME(3) NULL,

    INDEX `reports_status_idx`(`status`),
    UNIQUE INDEX `reports_subjectId_panelId_version_key`(`subjectId`, `panelId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `report_category_scores` (
    `id` CHAR(36) NOT NULL,
    `reportId` CHAR(36) NOT NULL,
    `categoryId` CHAR(36) NOT NULL,
    `rawScore` DECIMAL(8, 4) NOT NULL,
    `normalizedScore` DECIMAL(6, 2) NOT NULL,
    `band` ENUM('FAVORAVEL', 'MODERADO', 'ATENCAO', 'PRIORIDADE') NOT NULL,

    UNIQUE INDEX `report_category_scores_reportId_categoryId_key`(`reportId`, `categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `report_modality_indexes` (
    `id` CHAR(36) NOT NULL,
    `reportId` CHAR(36) NOT NULL,
    `modalityId` CHAR(36) NOT NULL,
    `rawIndex` DECIMAL(8, 4) NOT NULL,
    `normalizedIndex` DECIMAL(6, 2) NOT NULL,
    `band` ENUM('FAVORAVEL', 'MODERADO', 'ATENCAO', 'PRIORIDADE') NOT NULL,

    UNIQUE INDEX `report_modality_indexes_reportId_modalityId_key`(`reportId`, `modalityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `genotype_aliases` ADD CONSTRAINT `genotype_aliases_snpId_fkey` FOREIGN KEY (`snpId`) REFERENCES `snps`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `panel_categories` ADD CONSTRAINT `panel_categories_panelId_fkey` FOREIGN KEY (`panelId`) REFERENCES `panels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `panel_snps` ADD CONSTRAINT `panel_snps_panelId_fkey` FOREIGN KEY (`panelId`) REFERENCES `panels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `panel_snps` ADD CONSTRAINT `panel_snps_snpId_fkey` FOREIGN KEY (`snpId`) REFERENCES `snps`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `panel_snps` ADD CONSTRAINT `panel_snps_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `panel_categories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `genotype_scores` ADD CONSTRAINT `genotype_scores_panelSnpId_fkey` FOREIGN KEY (`panelSnpId`) REFERENCES `panel_snps`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `modalities` ADD CONSTRAINT `modalities_panelId_fkey` FOREIGN KEY (`panelId`) REFERENCES `panels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `modality_weights` ADD CONSTRAINT `modality_weights_modalityId_fkey` FOREIGN KEY (`modalityId`) REFERENCES `modalities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `modality_weights` ADD CONSTRAINT `modality_weights_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `panel_categories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `percentile_points` ADD CONSTRAINT `percentile_points_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `panel_categories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `percentile_points` ADD CONSTRAINT `percentile_points_modalityId_fkey` FOREIGN KEY (`modalityId`) REFERENCES `modalities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `interpretations` ADD CONSTRAINT `interpretations_panelId_fkey` FOREIGN KEY (`panelId`) REFERENCES `panels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subject_genotypes` ADD CONSTRAINT `subject_genotypes_snpId_fkey` FOREIGN KEY (`snpId`) REFERENCES `snps`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subject_genotypes` ADD CONSTRAINT `subject_genotypes_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `genotype_batches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_panelId_fkey` FOREIGN KEY (`panelId`) REFERENCES `panels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_category_scores` ADD CONSTRAINT `report_category_scores_reportId_fkey` FOREIGN KEY (`reportId`) REFERENCES `reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_category_scores` ADD CONSTRAINT `report_category_scores_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `panel_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_modality_indexes` ADD CONSTRAINT `report_modality_indexes_reportId_fkey` FOREIGN KEY (`reportId`) REFERENCES `reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_modality_indexes` ADD CONSTRAINT `report_modality_indexes_modalityId_fkey` FOREIGN KEY (`modalityId`) REFERENCES `modalities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
