-- Comércio: pedido, itens, endereço, pagamento, eventos e cupom.
CREATE TABLE `orders` (
  `id` CHAR(36) NOT NULL,
  `number` VARCHAR(20) NOT NULL,
  `userId` CHAR(36) NULL,
  `customerName` VARCHAR(160) NOT NULL,
  `customerEmail` VARCHAR(255) NOT NULL,
  `customerDoc` VARCHAR(18) NOT NULL,
  `customerPhone` VARCHAR(20) NULL,
  `status` ENUM('PENDING_PAYMENT','PAID','KIT_SHIPPED','KIT_DELIVERED','SAMPLE_IN_TRANSIT','SAMPLE_RECEIVED','PROCESSING','REPORT_READY','CANCELLED','REFUNDED') NOT NULL DEFAULT 'PENDING_PAYMENT',
  `subtotalCents` INTEGER NOT NULL,
  `discountCents` INTEGER NOT NULL DEFAULT 0,
  `shippingCents` INTEGER NOT NULL DEFAULT 0,
  `totalCents` INTEGER NOT NULL,
  `couponCode` VARCHAR(40) NULL,
  `commissionRate` DECIMAL(5,2) NULL,
  `commissionCents` INTEGER NULL,
  `shippingMethod` VARCHAR(40) NULL,
  `outboundTracking` VARCHAR(60) NULL,
  `inboundTracking` VARCHAR(60) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `paidAt` DATETIME(3) NULL,
  UNIQUE INDEX `orders_number_key`(`number`),
  INDEX `orders_status_idx`(`status`),
  INDEX `orders_userId_idx`(`userId`),
  INDEX `orders_customerEmail_idx`(`customerEmail`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `order_items` (
  `id` CHAR(36) NOT NULL, `orderId` CHAR(36) NOT NULL,
  `productSlug` VARCHAR(80) NOT NULL, `productName` VARCHAR(160) NOT NULL,
  `unitCents` INTEGER NOT NULL, `quantity` INTEGER NOT NULL DEFAULT 1,
  INDEX `order_items_orderId_idx`(`orderId`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `order_addresses` (
  `id` CHAR(36) NOT NULL, `orderId` CHAR(36) NOT NULL,
  `zipCode` VARCHAR(9) NOT NULL, `street` VARCHAR(200) NOT NULL,
  `number` VARCHAR(20) NOT NULL, `complement` VARCHAR(100) NULL,
  `neighborhood` VARCHAR(120) NOT NULL, `city` VARCHAR(120) NOT NULL, `state` VARCHAR(2) NOT NULL,
  UNIQUE INDEX `order_addresses_orderId_key`(`orderId`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payments` (
  `id` CHAR(36) NOT NULL, `orderId` CHAR(36) NOT NULL,
  `method` ENUM('CREDIT_CARD','PIX','BOLETO') NOT NULL,
  `status` ENUM('PENDING','AUTHORIZED','PAID','REFUSED','REFUNDED','EXPIRED') NOT NULL DEFAULT 'PENDING',
  `amountCents` INTEGER NOT NULL, `externalId` VARCHAR(120) NULL,
  `failureReason` VARCHAR(255) NULL, `installments` INTEGER NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `confirmedAt` DATETIME(3) NULL,
  INDEX `payments_orderId_idx`(`orderId`), INDEX `payments_externalId_idx`(`externalId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `order_events` (
  `id` CHAR(36) NOT NULL, `orderId` CHAR(36) NOT NULL,
  `status` ENUM('PENDING_PAYMENT','PAID','KIT_SHIPPED','KIT_DELIVERED','SAMPLE_IN_TRANSIT','SAMPLE_RECEIVED','PROCESSING','REPORT_READY','CANCELLED','REFUNDED') NOT NULL,
  `note` VARCHAR(500) NULL, `actor` VARCHAR(80) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `order_events_orderId_createdAt_idx`(`orderId`, `createdAt`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `coupons` (
  `id` CHAR(36) NOT NULL, `code` VARCHAR(40) NOT NULL,
  `discountPercent` DECIMAL(5,2) NOT NULL, `commissionPercent` DECIMAL(5,2) NOT NULL,
  `partnerName` VARCHAR(160) NULL, `active` BOOLEAN NOT NULL DEFAULT true,
  `expiresAt` DATETIME(3) NULL, `maxUses` INTEGER NULL, `usedCount` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `coupons_code_key`(`code`), INDEX `coupons_active_idx`(`active`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `order_items` ADD CONSTRAINT `order_items_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `order_addresses` ADD CONSTRAINT `order_addresses_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `payments` ADD CONSTRAINT `payments_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `order_events` ADD CONSTRAINT `order_events_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
