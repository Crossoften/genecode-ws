-- A lista primitiva dos 500 mil códigos da Genoa.
--
-- Sem ela o sistema inventava os códigos, e nenhum envelope impresso pelo
-- cliente ativava. O `sequencial` é a chave porque é a ordem em que a Genoa
-- imprime as etiquetas — e porque a ordem da lista é aleatória no espaço de
-- códigos, queimar em sequência não revela o próximo código a quem tem um
-- envelope em mãos.
CREATE TABLE `activation_codes` (
    `sequencial` INTEGER NOT NULL,
    `code` VARCHAR(12) NOT NULL,
    `usable` BOOLEAN NOT NULL DEFAULT true,
    `burnedAt` DATETIME(3) NULL,
    `batchId` CHAR(36) NULL,

    UNIQUE INDEX `activation_codes_code_key`(`code`),
    INDEX `activation_codes_burnedAt_usable_sequencial_idx`(`burnedAt`, `usable`, `sequencial`),
    INDEX `activation_codes_batchId_idx`(`batchId`),
    PRIMARY KEY (`sequencial`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
