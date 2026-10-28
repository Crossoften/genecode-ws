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
      'Olá, {nome}! Iniciamos o processamento da sua amostra de DNA. Nossa equipe seguirá as ' +
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
      'ambiental, que, quando integrado ao escore genético, resulta no escore combinado. ' +
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
 * Revisões de texto do cliente sobre os padrões anteriores (GC-AJ-025, doc de
 * 21/10/2026): "amostra **de DNA**", "resulta **no** escore combinado" e, onde
 * o banco ainda guarda o texto do protótipo (adm-10), o texto definitivo de
 * "Amostra recebida" e "Resultado disponível" — o card #526 deixou essa troca
 * para a tela do admin, e em homolog ninguém a fez.
 *
 * Só troca o texto que ainda está **igual a um padrão anterior** — se o admin
 * já editou o gatilho pela tela, a edição dele vale e nada é sobrescrito.
 */
const REVISIONS: ReadonlyArray<{ key: NotificationTriggerKey; from: string; to: string }> = [
  {
    key: NotificationTriggerKey.SAMPLE_RECEIVED,
    from: 'Recebemos sua amostra, {nome}! A análise genética já começou. 🧬',
    to: TRIGGERS.find((t) => t.key === NotificationTriggerKey.SAMPLE_RECEIVED)!.template,
  },
  {
    key: NotificationTriggerKey.REPORT_READY,
    from: 'Chegou, {nome}! Seu laudo genético está pronto. Acesse em {link_laudo}. ✨',
    to: TRIGGERS.find((t) => t.key === NotificationTriggerKey.REPORT_READY)!.template,
  },
  {
    key: NotificationTriggerKey.ANALYSIS_STARTED,
    from:
      'Olá, {nome}! Iniciamos o processamento da sua amostra. Nossa equipe seguirá as ' +
      'etapas técnicas e os controles de qualidade do seu exame genético.',
    to: TRIGGERS.find((t) => t.key === NotificationTriggerKey.ANALYSIS_STARTED)!.template,
  },
  {
    key: NotificationTriggerKey.REPORT_READY,
    from: TRIGGERS.find((t) => t.key === NotificationTriggerKey.REPORT_READY)!.template.replace(
      'resulta no escore combinado',
      'resulta em seu escore combinado',
    ),
    to: TRIGGERS.find((t) => t.key === NotificationTriggerKey.REPORT_READY)!.template,
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
  let revised = 0;
  for (const revision of REVISIONS) {
    const result = await prisma.notificationTrigger.updateMany({
      where: { key: revision.key, template: revision.from },
      data: { template: revision.to },
    });
    revised += result.count;
  }
  console.log(`✓ ${TRIGGERS.length} gatilhos de notificação (${revised} com texto revisado)`);
}
