-- AlterTable
ALTER TABLE `products` ADD COLUMN `category` VARCHAR(40) NULL,
    ADD COLUMN `dimensionsCm` VARCHAR(20) NULL,
    ADD COLUMN `weightGrams` INTEGER NULL;

-- CreateTable
CREATE TABLE `notification_triggers` (
    `id` CHAR(36) NOT NULL,
    `key` ENUM('ORDER_CONFIRMED', 'KIT_SHIPPED', 'SAMPLE_RECEIVED', 'REMINDER', 'REPORT_READY') NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `template` TEXT NOT NULL,
    `channelWhatsapp` BOOLEAN NOT NULL DEFAULT true,
    `channelEmail` BOOLEAN NOT NULL DEFAULT true,
    `channelSms` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `notification_triggers_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_logs` (
    `id` CHAR(36) NOT NULL,
    `triggerKey` ENUM('ORDER_CONFIRMED', 'KIT_SHIPPED', 'SAMPLE_RECEIVED', 'REMINDER', 'REPORT_READY') NOT NULL,
    `channel` ENUM('WHATSAPP', 'EMAIL', 'SMS') NOT NULL,
    `recipient` VARCHAR(255) NOT NULL,
    `orderId` CHAR(36) NULL,
    `status` ENUM('SENT', 'DELIVERED', 'FAILED') NOT NULL DEFAULT 'SENT',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notification_logs_createdAt_idx`(`createdAt`),
    INDEX `notification_logs_triggerKey_channel_idx`(`triggerKey`, `channel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
