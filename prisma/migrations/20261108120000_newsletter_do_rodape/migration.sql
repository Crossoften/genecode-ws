-- Newsletter do rodapé — "Fique por dentro" (GC-N05-17).
--
-- Tabela nova, só VARCHAR e DATETIME: nada de TEXT sem default, então aplica
-- limpo em homolog e em produção. O e-mail é único; a inscrição repetida é
-- ignorada pelo servidor (INSERT … IGNORE via skipDuplicates).
CREATE TABLE `newsletter_subscriptions` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `source` VARCHAR(40) NOT NULL,
    `consentText` VARCHAR(300) NOT NULL,
    `consentedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `newsletter_subscriptions_email_key`(`email`),
    INDEX `newsletter_subscriptions_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
