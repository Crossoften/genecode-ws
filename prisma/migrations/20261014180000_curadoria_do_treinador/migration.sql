-- Curadoria do perfil de treinador (card #526).
--
-- O cadastro do treinador vira perfil curado. Hoje nasce APPROVED (aprovação
-- automática, decisão do André), mas o status existe para a moderação futura
-- do admin/master ligar a fila de PENDING sem nova migração.
--
-- Backfill: todo perfil que já existe é aprovado, com approvedAt = createdAt e
-- approvedByUserId nulo (aprovado pelo sistema, não à mão).
ALTER TABLE `professional_profiles`
  ADD COLUMN `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN `approvedAt` DATETIME(3) NULL,
  ADD COLUMN `approvedByUserId` CHAR(36) NULL;

UPDATE `professional_profiles`
  SET `approvedAt` = `createdAt`
  WHERE `approvedAt` IS NULL;

CREATE INDEX `professional_profiles_status_idx` ON `professional_profiles`(`status`);
