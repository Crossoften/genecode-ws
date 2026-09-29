-- Integração com a PagoLivre (Afinz), decidida como adquirente do GeneCode.
--
-- O split da PagoLivre não aceita código de cupom nem chave Pix como
-- destinatário: exige o id de uma unidade cadastrada dentro dela. Esta coluna é
-- o de-para entre o nosso parceiro e a unidade dele lá.
--
-- Nullable de propósito. Enquanto o parceiro não estiver cadastrado na Afinz a
-- venda acontece normalmente e o `Payout` continua sendo criado — o repasse só
-- vira trabalho manual do financeiro. Bloquear a compra porque falta um cadastro
-- que não é do comprador seria punir quem não tem culpa.
ALTER TABLE `partners`
    ADD COLUMN `splitMerchantId` CHAR(36) NULL;

-- A PagoLivre não cobra pela API: ela cria uma ordem e devolve a URL de uma
-- página hospedada, para onde o comprador é levado. Guardar a URL é o que
-- permite retomar um pagamento pendente — o comprador que fecha a aba e volta
-- depois precisa do mesmo link, não de uma segunda cobrança.
ALTER TABLE `payments`
    ADD COLUMN `redirectUrl` VARCHAR(500) NULL;
