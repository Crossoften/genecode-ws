-- Código único do laboratório no titular do dado genético.
--
-- É o mesmo código impresso no kit e usado na primeira coluna do CSV de
-- resultados: liga kit → amostra → genótipo → laudo. Nulo é permitido porque um
-- titular pode existir antes do exame chegar (o kit é ativado antes da coleta).
ALTER TABLE `subjects` ADD COLUMN `externalCode` VARCHAR(32) NULL;
CREATE UNIQUE INDEX `subjects_externalCode_key` ON `subjects`(`externalCode`);
