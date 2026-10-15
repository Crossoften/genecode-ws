-- Dois gatilhos de notificação da fase laboratorial (card #526):
-- ANALYSIS_STARTED ("Análise iniciada") e ANALYSIS_IN_PROGRESS ("Análise em
-- andamento"), com os textos definitivos do cliente.
--
-- Valores ACRESCENTADOS NO FIM do ENUM: o MySQL guarda enum pelo índice, então
-- reordenar os valores existentes remapearia as linhas já gravadas. Acrescentar
-- no fim preserva os índices de ORDER_CONFIRMED..REPORT_READY.
ALTER TABLE `notification_triggers`
  MODIFY COLUMN `key` ENUM('ORDER_CONFIRMED', 'KIT_SHIPPED', 'SAMPLE_RECEIVED', 'REMINDER', 'REPORT_READY', 'ANALYSIS_STARTED', 'ANALYSIS_IN_PROGRESS') NOT NULL;

ALTER TABLE `notification_logs`
  MODIFY COLUMN `triggerKey` ENUM('ORDER_CONFIRMED', 'KIT_SHIPPED', 'SAMPLE_RECEIVED', 'REMINDER', 'REPORT_READY', 'ANALYSIS_STARTED', 'ANALYSIS_IN_PROGRESS') NOT NULL;
