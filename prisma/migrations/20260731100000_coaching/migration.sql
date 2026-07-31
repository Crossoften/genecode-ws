-- Acompanhamento profissional: perfil, compartilhamento LGPD e entrevistas.
CREATE TABLE `professional_profiles` (
  `id` CHAR(36) NOT NULL, `userId` CHAR(36) NOT NULL,
  `specialty` VARCHAR(60) NOT NULL, `councilId` VARCHAR(40) NULL, `bio` VARCHAR(500) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `professional_profiles_userId_key`(`userId`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `data_sharings` (
  `id` CHAR(36) NOT NULL, `subjectId` CHAR(36) NOT NULL, `professionalId` CHAR(36) NOT NULL,
  `status` ENUM('PENDING','AUTHORIZED','REVOKED') NOT NULL DEFAULT 'PENDING',
  `initiatedBy` ENUM('PATIENT','PROFESSIONAL') NOT NULL,
  `consentDocumentId` CHAR(36) NULL,
  `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `authorizedAt` DATETIME(3) NULL, `revokedAt` DATETIME(3) NULL, `ipAddress` VARCHAR(45) NULL,
  UNIQUE INDEX `data_sharings_subjectId_professionalId_key`(`subjectId`, `professionalId`),
  INDEX `data_sharings_professionalId_status_idx`(`professionalId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `assessments` (
  `id` CHAR(36) NOT NULL, `subjectId` CHAR(36) NOT NULL, `professionalId` CHAR(36) NOT NULL,
  `checkpoint` ENUM('Q0','Q1','Q2','Q3','Q4') NOT NULL,
  `answers` JSON NOT NULL, `environmentalScores` JSON NULL, `adjustedScores` JSON NULL,
  `completedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `assessments_subjectId_checkpoint_key`(`subjectId`, `checkpoint`),
  INDEX `assessments_professionalId_idx`(`professionalId`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `data_sharings` ADD CONSTRAINT `data_sharings_professionalId_fkey` FOREIGN KEY (`professionalId`) REFERENCES `professional_profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `assessments` ADD CONSTRAINT `assessments_professionalId_fkey` FOREIGN KEY (`professionalId`) REFERENCES `professional_profiles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
