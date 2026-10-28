-- Pedido de exclusão de conta pelo titular (GC-AJ-006): registro com data, que
-- a Genoa avalia e responde. Não apaga nada por si.
CREATE TABLE `account_deletion_requests` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `reason` VARCHAR(1000) NULL,
    `status` ENUM('OPEN', 'DONE', 'DECLINED') NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `handledAt` DATETIME(3) NULL,
    `handledByUserId` CHAR(36) NULL,
    `resolution` VARCHAR(1000) NULL,

    INDEX `account_deletion_requests_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `account_deletion_requests_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
