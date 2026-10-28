-- Envios na transportadora (DHL, GC-AJ-038 a 041): ida do kit e volta da
-- amostra, com a etiqueta guardada (a DHL só a entrega na criação), a coleta
-- agendada e os eventos de rastreio.
CREATE TABLE `shipments` (
    `id` CHAR(36) NOT NULL,
    `orderId` CHAR(36) NOT NULL,
    `direction` ENUM('OUTBOUND', 'INBOUND') NOT NULL,
    `carrier` VARCHAR(20) NOT NULL,
    `trackingCode` VARCHAR(60) NOT NULL,
    `trackingUrl` VARCHAR(500) NULL,
    `labelFormat` VARCHAR(8) NULL,
    `labelBase64` LONGTEXT NULL,
    `pickupConfirmation` VARCHAR(60) NULL,
    `pickupAt` DATETIME(3) NULL,
    `pickupCloseTime` VARCHAR(5) NULL,
    `pickupLocation` VARCHAR(80) NULL,
    `pickupAddress` JSON NULL,
    `events` JSON NULL,
    `lastEventCode` VARCHAR(8) NULL,
    `lastSyncedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `shipments_orderId_direction_key`(`orderId`, `direction`),
    INDEX `shipments_trackingCode_idx`(`trackingCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `shipments` ADD CONSTRAINT `shipments_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
