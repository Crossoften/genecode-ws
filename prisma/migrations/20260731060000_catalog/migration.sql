-- Catálogo de produtos da vitrine.
CREATE TABLE `products` (
  `id` CHAR(36) NOT NULL,
  `slug` VARCHAR(80) NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `summary` VARCHAR(200) NOT NULL,
  `description` TEXT NOT NULL,
  `panelSlug` VARCHAR(64) NULL,
  `markerCount` INTEGER NOT NULL,
  `priceCents` INTEGER NOT NULL,
  `promoPriceCents` INTEGER NULL,
  `maxInstallments` INTEGER NOT NULL DEFAULT 12,
  `published` BOOLEAN NOT NULL DEFAULT false,
  `archived` BOOLEAN NOT NULL DEFAULT false,
  `highlight` VARCHAR(40) NULL,
  `position` INTEGER NOT NULL DEFAULT 0,
  `imageUrl` VARCHAR(500) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `products_slug_key`(`slug`),
  INDEX `products_published_archived_idx`(`published`, `archived`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `product_features` (
  `id` CHAR(36) NOT NULL,
  `productId` CHAR(36) NOT NULL,
  `label` VARCHAR(200) NOT NULL,
  `position` INTEGER NOT NULL DEFAULT 0,
  INDEX `product_features_productId_idx`(`productId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `product_traits` (
  `id` CHAR(36) NOT NULL,
  `productId` CHAR(36) NOT NULL,
  `trait` VARCHAR(40) NOT NULL,
  `weight` INTEGER NOT NULL,
  UNIQUE INDEX `product_traits_productId_trait_key`(`productId`, `trait`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `product_features` ADD CONSTRAINT `product_features_productId_fkey`
  FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `product_traits` ADD CONSTRAINT `product_traits_productId_fkey`
  FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
