-- Dimensão de checkpoint no questionário ambiental (decisão 23 do André em
-- 09/09: valem as 120 perguntas do mockup, 24 por checkpoint). Nullable de
-- propósito: as perguntas já existentes, e as que o laboratório criar pelo
-- admin, continuam valendo para Q0–Q4.
ALTER TABLE `environmental_questions`
    ADD COLUMN `checkpoint` ENUM('Q0', 'Q1', 'Q2', 'Q3', 'Q4') NULL;

-- CreateIndex
CREATE INDEX `environmental_questions_panelSlug_checkpoint_idx`
    ON `environmental_questions`(`panelSlug`, `checkpoint`);

-- A pontuação passa a ser por posição da opção (§3.3: 100 / 66,7 / 33,3 / 0),
-- e 66,7 não cabe em INTEGER.
ALTER TABLE `environmental_options`
    MODIFY `points` DOUBLE NOT NULL;
