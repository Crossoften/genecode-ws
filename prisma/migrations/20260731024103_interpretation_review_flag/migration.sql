-- AlterTable
ALTER TABLE `interpretations` ADD COLUMN `reviewNote` VARCHAR(500) NULL,
    ADD COLUMN `reviewRequired` BOOLEAN NOT NULL DEFAULT false;
