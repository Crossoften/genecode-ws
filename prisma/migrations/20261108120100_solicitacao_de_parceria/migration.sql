-- "Seja parceiro" para quem já tem conta (GC-N05-14, reunião de 05/11).
--
-- Tabela nova, vazia: não mexe em nenhuma linha existente. O parceiro só nasce
-- quando um admin aprova o pedido. `pendingUserId` é único e só fica preenchido
-- enquanto o pedido está em análise — é o que segura, no banco, um pedido
-- aberto por conta (o MySQL não tem índice parcial; NULL não colide com NULL).
CREATE TABLE `partner_applications` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `pendingUserId` CHAR(36) NULL,
    `type` ENUM('INDIVIDUAL', 'COMPANY') NOT NULL,
    `displayName` VARCHAR(160) NOT NULL,
    `document` VARCHAR(18) NOT NULL,
    `channel` VARCHAR(200) NOT NULL,
    `pixKeyType` VARCHAR(20) NULL,
    `pixKey` VARCHAR(140) NULL,
    `note` VARCHAR(500) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `decidedAt` DATETIME(3) NULL,
    `decidedByUserId` CHAR(36) NULL,
    `decisionNote` VARCHAR(500) NULL,
    `partnerId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `partner_applications_pendingUserId_key`(`pendingUserId`),
    INDEX `partner_applications_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `partner_applications_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
