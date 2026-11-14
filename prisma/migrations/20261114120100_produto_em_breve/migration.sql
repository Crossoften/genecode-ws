-- GC-N14-15: produto "em breve" — aparece na vitrine, mas não vende.
ALTER TABLE `products` ADD COLUMN `comingSoon` BOOLEAN NOT NULL DEFAULT false;

-- Pedido de 13/11: Nutrigenética e o combo (NutriPerformance) ficam "em breve".
-- O admin desliga pelo formulário do produto quando forem lançados.
UPDATE `products` SET `comingSoon` = true WHERE `slug` IN ('nutrigenetica', 'premium');
