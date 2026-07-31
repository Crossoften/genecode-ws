-- Parceiros afiliados e repasses de comissão.
CREATE TABLE `partners` (
  `id` CHAR(36) NOT NULL, `userId` CHAR(36) NOT NULL,
  `type` ENUM('INDIVIDUAL','COMPANY') NOT NULL,
  `displayName` VARCHAR(160) NOT NULL, `document` VARCHAR(18) NOT NULL, `channel` VARCHAR(200) NULL,
  `couponCode` VARCHAR(40) NOT NULL,
  `pixKeyType` VARCHAR(20) NULL, `pixKey` VARCHAR(140) NULL,
  `bankName` VARCHAR(80) NULL, `bankBranch` VARCHAR(20) NULL, `bankAccount` VARCHAR(30) NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `partners_userId_key`(`userId`), UNIQUE INDEX `partners_couponCode_key`(`couponCode`),
  INDEX `partners_active_idx`(`active`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payouts` (
  `id` CHAR(36) NOT NULL, `partnerId` CHAR(36) NOT NULL,
  `orderId` CHAR(36) NOT NULL, `orderNumber` VARCHAR(20) NOT NULL,
  `amountCents` INTEGER NOT NULL,
  `status` ENUM('PENDING','PROCESSING','SETTLED','REVERSED') NOT NULL DEFAULT 'PENDING',
  `externalId` VARCHAR(120) NULL, `settledAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `payouts_orderId_key`(`orderId`),
  INDEX `payouts_partnerId_status_idx`(`partnerId`, `status`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payouts` ADD CONSTRAINT `payouts_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
