-- Repasse por parceiro, e o plano de split congelado no pedido.
--
-- O `Payout` era um por pedido (`@@unique([orderId])`), o que impedia
-- fisicamente mais de um parceiro receber da mesma venda. Passa a ser um por
-- parceiro por pedido, com o nível e a fatia congelados no momento da venda:
-- a rede muda, e um repasse de março não pode mudar de valor porque alguém foi
-- promovido em junho.
--
-- Os repasses que já existem viram nível 1 com 20% — que é o que eram, quando
-- a comissão era um número só no cupom. `viaSplit` fica TRUE para os que já
-- tinham ido pela adquirente: todos os atuais, porque antes a venda sem
-- `splitMerchantId` simplesmente não mandava split e o repasse já era manual.
-- Como não há registro de qual foi qual, marcamos FALSE e o financeiro confere
-- — errar para o lado de "confira" é mais barato que errar para "já foi pago".

ALTER TABLE `payouts`
  ADD COLUMN `level` INT NOT NULL DEFAULT 1,
  ADD COLUMN `sharePercent` DECIMAL(5,2) NOT NULL DEFAULT 20.00,
  ADD COLUMN `viaSplit` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `payouts` DROP INDEX `payouts_orderId_key`;
CREATE UNIQUE INDEX `payouts_orderId_partnerId_key` ON `payouts`(`orderId`, `partnerId`);
CREATE INDEX `payouts_orderId_idx` ON `payouts`(`orderId`);

ALTER TABLE `orders` ADD COLUMN `splitPlan` JSON NULL;
