-- Fotos dos três kits como dado de partida (GC-AJ-002).
--
-- Em homolog as fotos foram enviadas pelo admin e moram no disco da VPS de
-- homolog. A produção subiu em 28/10/2026 sem elas, com a caixa nos três kits.
-- Agora as fotos vão junto com o front, em `public/kits/`, e esta migration as
-- põe na frente da galeria só onde o produto ainda não tem foto própria. O que
-- o admin já enviou fica como está, e homolog não muda.
--
-- "Sem foto própria" é o estado que a 20261028130000_galeria_de_produto deixa:
-- `imageUrl` na caixa e a galeria começando na posição 1.

INSERT INTO `product_images` (`id`, `productId`, `url`, `alt`, `position`)
  SELECT UUID(), `p`.`id`, `f`.`url`, `f`.`alt`, 0
  FROM `products` `p`
  JOIN (
    SELECT 'performance' AS `slug`, 'kits/performance.webp' AS `url`,
           'Atleta numa pista de atletismo' AS `alt`
    UNION ALL SELECT 'nutrigenetica', 'kits/nutrigenetica.webp',
           'Homem na cozinha segurando o kit gene.code'
    UNION ALL SELECT 'premium', 'kits/nutriperformance.webp',
           'Mulher numa quadra de tênis segurando o kit gene.code'
  ) `f` ON `f`.`slug` = `p`.`slug`
  WHERE `p`.`imageUrl` IS NULL OR `p`.`imageUrl` IN ('', 'kit-caixa-dinamica.webp');

UPDATE `products` `p`
  JOIN `product_images` `i` ON `i`.`productId` = `p`.`id` AND `i`.`position` = 0
  SET `p`.`imageUrl` = `i`.`url`
  WHERE `i`.`url` LIKE 'kits/%'
    AND (`p`.`imageUrl` IS NULL OR `p`.`imageUrl` IN ('', 'kit-caixa-dinamica.webp'));
