-- Rede de parceiros em cascata, até o 5º nível (decisão do André em 03/10).
--
-- Os parceiros que já existem viram raiz de rede, cada um com o bolo inteiro
-- de 20% — que é exatamente o que recebiam antes, quando a comissão era um
-- número só no cupom. Nenhum repasse muda de valor por causa desta migração.

ALTER TABLE `partners`
  ADD COLUMN `parentId` CHAR(36) NULL,
  ADD COLUMN `level` INT NOT NULL DEFAULT 1,
  ADD COLUMN `sharePercent` DECIMAL(5,2) NOT NULL DEFAULT 20.00,
  ADD COLUMN `bankCode` VARCHAR(5) NULL,
  ADD COLUMN `bankAgencyDigit` VARCHAR(2) NULL,
  ADD COLUMN `bankAccountDigit` VARCHAR(2) NULL,
  ADD COLUMN `bankAccountType` ENUM('CHECKING','SAVINGS') NULL;

CREATE INDEX `partners_parentId_idx` ON `partners`(`parentId`);

ALTER TABLE `partners`
  ADD CONSTRAINT `partners_parentId_fkey`
  FOREIGN KEY (`parentId`) REFERENCES `partners`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `partner_invites` (
  `id` CHAR(36) NOT NULL,
  `partnerId` CHAR(36) NOT NULL,
  `tokenHash` CHAR(64) NOT NULL,
  `sharePercent` DECIMAL(5,2) NOT NULL,
  `label` VARCHAR(120) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `acceptedAt` DATETIME(3) NULL,
  `acceptedByPartnerId` CHAR(36) NULL,
  `revokedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `partner_invites_tokenHash_key`(`tokenHash`),
  UNIQUE INDEX `partner_invites_acceptedByPartnerId_key`(`acceptedByPartnerId`),
  INDEX `partner_invites_partnerId_idx`(`partnerId`),
  INDEX `partner_invites_expiresAt_idx`(`expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `partner_invites`
  ADD CONSTRAINT `partner_invites_partnerId_fkey`
  FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `partner_invites`
  ADD CONSTRAINT `partner_invites_acceptedByPartnerId_fkey`
  FOREIGN KEY (`acceptedByPartnerId`) REFERENCES `partners`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Cupom de parceiro é identificador, não desconto (decisão do André, 03/10).
-- Desconto fica só com a Genoa, em campanha própria. Os cupons que hoje
-- pertencem a um parceiro perdem o desconto; os de campanha não são tocados.
UPDATE `coupons` c
  SET c.`discountPercent` = 0.00
  WHERE EXISTS (SELECT 1 FROM `partners` p WHERE p.`couponCode` = c.`code`);
