-- Quando a retirada foi pedida (GC-AJ-042): a simulação da volta parte daqui.
ALTER TABLE `shipments` ADD COLUMN `pickupRequestedAt` DATETIME(3) NULL;
