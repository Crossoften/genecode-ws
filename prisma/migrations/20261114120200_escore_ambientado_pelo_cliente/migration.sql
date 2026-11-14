-- GC-N14-14: o próprio cliente responde o questionário do escore ambientado.
-- A avaliação deixa de exigir um treinador; nulo = respondida pelo titular.

-- DropForeignKey
ALTER TABLE `assessments` DROP FOREIGN KEY `assessments_professionalId_fkey`;

-- AlterTable
ALTER TABLE `assessments` MODIFY `professionalId` CHAR(36) NULL;

-- AddForeignKey
ALTER TABLE `assessments` ADD CONSTRAINT `assessments_professionalId_fkey` FOREIGN KEY (`professionalId`) REFERENCES `professional_profiles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
