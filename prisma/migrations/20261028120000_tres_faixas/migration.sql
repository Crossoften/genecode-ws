-- Três faixas no lugar das quatro (GC-AJ-014, reunião de 20/10/2026).
--
-- Antes: FAVORAVEL ≥73 · MODERADO ≥55 · ATENCAO ≥38 · PRIORIDADE.
-- Agora: DESFAVORAVEL ≤33 · INTERMEDIARIO >33 a 66 · FAVORAVEL >66, sobre o
-- número que o paciente vê (escala 20–90), como no guia da matriz do cliente.
--
-- Em três passos, porque o MySQL recusa (ou zera, fora do modo estrito) um
-- valor gravado que não exista mais no ENUM:
--   1. amplia o ENUM com os valores novos;
--   2. recalcula a faixa de TODO escore já gravado a partir do próprio número —
--      nenhum laudo antigo fica com o rótulo da escala velha;
--   3. encolhe o ENUM para os três valores finais, na ordem do schema.
--
-- Volta atrás: o número não muda, só o rótulo. Para reverter, ampliar de novo,
-- recalcular com os cortes 73/55/38 e encolher para os quatro valores antigos.

ALTER TABLE `report_category_scores`
  MODIFY COLUMN `band` ENUM('FAVORAVEL', 'MODERADO', 'ATENCAO', 'PRIORIDADE', 'INTERMEDIARIO', 'DESFAVORAVEL') NOT NULL;
ALTER TABLE `report_modality_indexes`
  MODIFY COLUMN `band` ENUM('FAVORAVEL', 'MODERADO', 'ATENCAO', 'PRIORIDADE', 'INTERMEDIARIO', 'DESFAVORAVEL') NOT NULL;

UPDATE `report_category_scores`
  SET `band` = CASE
    WHEN `normalizedScore` > 66 THEN 'FAVORAVEL'
    WHEN `normalizedScore` > 33 THEN 'INTERMEDIARIO'
    ELSE 'DESFAVORAVEL'
  END;
UPDATE `report_modality_indexes`
  SET `band` = CASE
    WHEN `normalizedIndex` > 66 THEN 'FAVORAVEL'
    WHEN `normalizedIndex` > 33 THEN 'INTERMEDIARIO'
    ELSE 'DESFAVORAVEL'
  END;

ALTER TABLE `report_category_scores`
  MODIFY COLUMN `band` ENUM('FAVORAVEL', 'INTERMEDIARIO', 'DESFAVORAVEL') NOT NULL;
ALTER TABLE `report_modality_indexes`
  MODIFY COLUMN `band` ENUM('FAVORAVEL', 'INTERMEDIARIO', 'DESFAVORAVEL') NOT NULL;
