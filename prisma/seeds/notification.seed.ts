import type { PrismaClient } from '@prisma/client';
import { NotificationTriggerKey } from '@prisma/client';

/**
 * Gatilhos do funil de notificações, com os textos exatos do protótipo
 * aprovado (adm-10) — placeholders literais e emojis inclusos.
 */
const TRIGGERS = [
  {
    key: NotificationTriggerKey.ORDER_CONFIRMED,
    enabled: true,
    template: 'Olá {nome}! Recebemos seu pedido {pedido}. Em breve seu kit será enviado. 💜',
    channelWhatsapp: true,
    channelEmail: true,
    channelSms: false,
  },
  {
    key: NotificationTriggerKey.KIT_SHIPPED,
    enabled: true,
    template: '{nome}, seu kit GeneCode saiu para entrega! Rastreie em {link_rastreio}.',
    channelWhatsapp: true,
    channelEmail: false,
    channelSms: true,
  },
  {
    key: NotificationTriggerKey.SAMPLE_RECEIVED,
    enabled: true,
    template: 'Recebemos sua amostra, {nome}! A análise genética já começou. 🧬',
    channelWhatsapp: true,
    channelEmail: true,
    channelSms: false,
  },
  {
    key: NotificationTriggerKey.REMINDER,
    enabled: false,
    template: '{nome}, seu laudo está em processamento. Em breve novidades!',
    channelWhatsapp: false,
    channelEmail: true,
    channelSms: false,
  },
  {
    key: NotificationTriggerKey.REPORT_READY,
    enabled: true,
    template: 'Chegou, {nome}! Seu laudo genético está pronto. Acesse em {link_laudo}. ✨',
    channelWhatsapp: true,
    channelEmail: true,
    channelSms: true,
  },
];

/**
 * Semeia os gatilhos de notificação. Idempotente por key.
 *
 * O `update` é vazio de propósito: toggle, texto e canais são editáveis pelo
 * admin na tela de Notificações, e rodar o seed de novo não pode desfazer
 * essas escolhas.
 */
export async function seedNotificationTriggers(prisma: PrismaClient): Promise<void> {
  for (const trigger of TRIGGERS) {
    await prisma.notificationTrigger.upsert({
      where: { key: trigger.key },
      update: {},
      create: trigger,
    });
  }
  console.log(`✓ ${TRIGGERS.length} gatilhos de notificação`);
}
