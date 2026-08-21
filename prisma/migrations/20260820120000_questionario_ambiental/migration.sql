-- CreateTable
CREATE TABLE `environmental_questions` (
    `id` CHAR(36) NOT NULL,
    `panelSlug` VARCHAR(64) NOT NULL,
    `categorySlug` VARCHAR(80) NOT NULL,
    `text` VARCHAR(400) NOT NULL,
    `weight` DOUBLE NOT NULL DEFAULT 1,
    `order` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `environmental_questions_panelSlug_categorySlug_idx`(`panelSlug`, `categorySlug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `environmental_options` (
    `id` CHAR(36) NOT NULL,
    `questionId` CHAR(36) NOT NULL,
    `label` VARCHAR(200) NOT NULL,
    `points` INTEGER NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,

    INDEX `environmental_options_questionId_idx`(`questionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `environmental_options` ADD CONSTRAINT `environmental_options_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `environmental_questions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
