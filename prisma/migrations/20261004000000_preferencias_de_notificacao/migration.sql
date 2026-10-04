-- Preferências de aviso por titular (aba "Notificações" do perfil, GEN-13).
--
-- Três colunas no usuário, com o mesmo padrão dos gatilhos globais:
-- e-mail e WhatsApp ligados, SMS desligado. Sem backfill: o DEFAULT já
-- responde pelas contas existentes.
ALTER TABLE `users`
  ADD COLUMN `notifyEmail` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `notifyWhatsapp` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `notifySms` BOOLEAN NOT NULL DEFAULT false;
