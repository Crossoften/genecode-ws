-- Funil do checkout (GC-AJ-037): uma linha por sessão e etapa.
CREATE TABLE `checkout_funnel_events` (
    `id` CHAR(36) NOT NULL,
    `session` VARCHAR(64) NOT NULL,
    `stage` ENUM('CART', 'DATA', 'PAYMENT') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `checkout_funnel_events_session_stage_key`(`session`, `stage`),
    INDEX `checkout_funnel_events_stage_createdAt_idx`(`stage`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
