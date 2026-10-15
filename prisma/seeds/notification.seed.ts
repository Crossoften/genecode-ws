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
    template: '{nome}, seu kit gene.code saiu para entrega! Rastreie em {link_rastreio}.',
    channelWhatsapp: true,
    channelEmail: false,
    channelSms: true,
  },
  // Textos definitivos da fase laboratorial (card #526).
  {
    key: NotificationTriggerKey.SAMPLE_RECEIVED,
    enabled: true,
    template:
      'Olá, {nome}! Sua amostra chegou ao nosso laboratório. Agora vamos conferir sua ' +
      'identificação e as condições para iniciar a análise.',
    channelWhatsapp: true,
    channelEmail: true,
    channelSms: false,
  },
  {
    key: NotificationTriggerKey.ANALYSIS_STARTED,
    enabled: true,
    template:
      'Olá, {nome}! Iniciamos o processamento da sua amostra. Nossa equipe seguirá as ' +
      'etapas técnicas e os controles de qualidade do seu exame genético.',
    channelWhatsapp: true,
    channelEmail: true,
    channelSms: false,
  },
  {
    key: NotificationTriggerKey.ANALYSIS_IN_PROGRESS,
    enabled: true,
    template:
      'Olá, {nome}! Sua análise está em andamento. Estamos cuidando de cada etapa para ' +
      'disponibilizar seu resultado com qualidade e segurança.',
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
    // "Resultado disponível" — texto definitivo do cliente (card #526). É longo
    // de propósito (explica o escore ambiental/combinado), então SMS fica
    // desligado: cabe em e-mail e WhatsApp, não num SMS.
    key: NotificationTriggerKey.REPORT_READY,
    enabled: true,
    template:
      'Olá, {nome}! Seu exame foi concluído e o resultado já está disponível! A partir de ' +
      'agora, você poderá realizar avaliações trimestrais para acompanhar seus hábitos, sua ' +
      'rotina de atividade física e suas metas. Essas informações compõem seu escore ' +
      'ambiental, que, quando integrado ao escore genético, resulta em seu escore combinado. ' +
      'Seu perfil genético permanece o mesmo, mas mudanças nos fatores ambientais podem ' +
      'melhorar seu escore combinado e ajudar você a acompanhar sua evolução. O resultado é ' +
      'uma estimativa que apoia suas escolhas e seu planejamento — suas possibilidades vão ' +
      'além de um número!',
    channelWhatsapp: true,
    channelEmail: true,
    channelSms: false,
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
