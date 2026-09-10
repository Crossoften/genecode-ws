-- Amplia o label da feature de 200 para 300 caracteres.
--
-- O texto de acompanhamentos de performance enviado pelo cliente em 09/09 tem
-- 209 caracteres e o André decidiu (item 27) mantê-lo como UM item só na lista,
-- em vez de quebrá-lo em quatro. Alargar a coluna é o caminho: só cresce, não
-- trunca nada existente, e não exige backfill.
ALTER TABLE `product_features` MODIFY `label` VARCHAR(300) NOT NULL;
