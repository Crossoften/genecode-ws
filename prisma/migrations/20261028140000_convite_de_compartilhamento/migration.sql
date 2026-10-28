-- Compartilhar o laudo com um profissional que ainda não tem conta (GC-AJ-027).
CREATE TABLE `sharing_invites` (
    `id` CHAR(36) NOT NULL,
    `subjectId` CHAR(36) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `invitedByUserId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `acceptedAt` DATETIME(3) NULL,
    `sharingId` CHAR(36) NULL,

    UNIQUE INDEX `sharing_invites_subjectId_email_key`(`subjectId`, `email`),
    INDEX `sharing_invites_email_acceptedAt_idx`(`email`, `acceptedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
