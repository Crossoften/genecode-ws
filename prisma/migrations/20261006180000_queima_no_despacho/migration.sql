-- O número é queimado no despacho, não numa emissão de lote.
--
-- As etiquetas já estão impressas em papel antes de o sistema ver qualquer
-- uma: quem monta o kit pega um adesivo qualquer do monte. Não existe "lote
-- emitido pela plataforma", e por isso o kit passa a nascer sem lote e o
-- código queimado passa a apontar para o PEDIDO em que apareceu.
ALTER TABLE `activation_codes` DROP INDEX `activation_codes_batchId_idx`;
ALTER TABLE `activation_codes` DROP INDEX `activation_codes_burnedAt_usable_sequencial_idx`;
ALTER TABLE `activation_codes` CHANGE COLUMN `batchId` `orderId` CHAR(36) NULL;
CREATE INDEX `activation_codes_burnedAt_idx` ON `activation_codes`(`burnedAt`);
CREATE INDEX `activation_codes_orderId_idx` ON `activation_codes`(`orderId`);

-- Kit despachado não pertence a lote nenhum nosso.
ALTER TABLE `kits` DROP FOREIGN KEY `kits_batchId_fkey`;
ALTER TABLE `kits` MODIFY COLUMN `batchId` CHAR(36) NULL;
ALTER TABLE `kits` ADD CONSTRAINT `kits_batchId_fkey`
  FOREIGN KEY (`batchId`) REFERENCES `kit_batches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
