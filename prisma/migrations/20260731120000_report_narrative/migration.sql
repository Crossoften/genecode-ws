-- Texto de recomendação do laudo, gerado uma vez na emissão (decisão L4).
-- Guarda texto + provedor + modelo + versão do prompt, para reprodutibilidade.
ALTER TABLE `reports` ADD COLUMN `narrative` JSON NULL;
