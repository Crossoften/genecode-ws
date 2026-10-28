-- Galeria de fotos por produto (GC-AJ-032, teste assistido de 20/10/2026).
--
-- Até aqui o produto tinha uma foto (`imageUrl`) e as quatro da caixa eram
-- arquivos fixos do front, invisíveis no admin. A tabela nova guarda todas, na
-- ordem; `products.imageUrl` continua existindo e passa a ser sempre a primeira.

CREATE TABLE `product_images` (
    `id` CHAR(36) NOT NULL,
    `productId` CHAR(36) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `alt` VARCHAR(200) NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `product_images_productId_position_idx`(`productId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `product_images` ADD CONSTRAINT `product_images_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- A foto própria, quando o admin já tinha enviado uma, abre a galeria.
INSERT INTO `product_images` (`id`, `productId`, `url`, `alt`, `position`)
  SELECT UUID(), `id`, `imageUrl`, NULL, 0 FROM `products` WHERE `imageUrl` IS NOT NULL AND `imageUrl` <> '';

-- As quatro fotos da caixa, que eram fixas no front (FOTOS_KIT), viram dado em
-- todo produto, depois da foto própria.
INSERT INTO `product_images` (`id`, `productId`, `url`, `alt`, `position`)
  SELECT UUID(), `p`.`id`, `f`.`url`, `f`.`alt`, `f`.`pos`
  FROM `products` `p`
  CROSS JOIN (
    SELECT 'kit-caixa-dinamica.webp' AS `url`, 'Caixa do kit de coleta de DNA gene.code' AS `alt`, 1 AS `pos`
    UNION ALL SELECT 'kit-caixa-lateral.webp', 'Caixa do kit gene.code vista de lado', 2
    UNION ALL SELECT 'kit-aberto.webp', 'Kit gene.code aberto, com o conteúdo à mostra', 3
    UNION ALL SELECT 'kit-elementos.webp', 'Envelope de remessa, declaração e os dois swabs de coleta que vêm no kit', 4
  ) `f`;

-- Produto sem foto própria passa a ter a caixa como principal, como a vitrine
-- já mostrava.
UPDATE `products` SET `imageUrl` = 'kit-caixa-dinamica.webp' WHERE `imageUrl` IS NULL OR `imageUrl` = '';
