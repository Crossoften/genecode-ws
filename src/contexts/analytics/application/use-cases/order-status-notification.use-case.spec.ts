import { OrderStatus } from '@contexts/ordering/domain/order-status';
import type { PrismaService } from '@infra/database/prisma.service';

import {
  OrderStatusNotificationUseCase,
  type NotifiableOrder,
} from './order-status-notification.use-case';

/**
 * O disparo é só um NotificationLog — a operadora não existe — mas o mapeamento
 * status→gatilho e a escolha de canais são exatamente o contrato que o envio
 * real vai herdar. Errar aqui é notificar etapa errada ou canal sem destino.
 */
describe('OrderStatusNotificationUseCase', () => {
  const order: NotifiableOrder = {
    id: 'pedido-1',
    customerEmail: 'helena.v@email.com',
    customerPhone: '+5511988214470',
  };

  function buildPrisma(
    trigger: {
      enabled?: boolean;
      channelWhatsapp?: boolean;
      channelEmail?: boolean;
      channelSms?: boolean;
    } | null = {},
  ) {
    const row =
      trigger === null
        ? null
        : {
            id: 'trigger-1',
            enabled: trigger.enabled ?? true,
            template: 'Olá {nome}!',
            channelWhatsapp: trigger.channelWhatsapp ?? true,
            channelEmail: trigger.channelEmail ?? true,
            channelSms: trigger.channelSms ?? false,
          };

    return {
      notificationTrigger: {
        findUnique: jest.fn(async ({ where }: { where: { key: string } }) =>
          row === null ? null : { ...row, key: where.key },
        ),
      },
      notificationLog: {
        createMany: jest.fn(async () => ({ count: 0 })),
      },
    };
  }

  const useCase = (prisma: ReturnType<typeof buildPrisma>) =>
    new OrderStatusNotificationUseCase(prisma as unknown as PrismaService);

  it.each([
    [OrderStatus.PAID, 'ORDER_CONFIRMED'],
    [OrderStatus.KIT_SHIPPED, 'KIT_SHIPPED'],
    [OrderStatus.SAMPLE_RECEIVED, 'SAMPLE_RECEIVED'],
    [OrderStatus.REPORT_READY, 'REPORT_READY'],
  ])('mapeia %s para o gatilho %s', async (status, triggerKey) => {
    const prisma = buildPrisma();

    await useCase(prisma).execute(order, status);

    expect(prisma.notificationTrigger.findUnique).toHaveBeenCalledWith({
      where: { key: triggerKey },
    });
  });

  it.each([
    OrderStatus.PENDING_PAYMENT,
    OrderStatus.KIT_DELIVERED,
    OrderStatus.SAMPLE_IN_TRANSIT,
    OrderStatus.PROCESSING,
    OrderStatus.CANCELLED,
    OrderStatus.REFUNDED,
  ])('%s não notifica nem consulta gatilho', async (status) => {
    const prisma = buildPrisma();

    const dispatches = await useCase(prisma).execute(order, status);

    expect(dispatches).toEqual([]);
    expect(prisma.notificationTrigger.findUnique).not.toHaveBeenCalled();
    expect(prisma.notificationLog.createMany).not.toHaveBeenCalled();
  });

  it('usa os canais padrão do gatilho quando o body não escolhe', async () => {
    const prisma = buildPrisma({ channelWhatsapp: true, channelEmail: true, channelSms: false });

    const dispatches = await useCase(prisma).execute(order, OrderStatus.PAID);

    expect(dispatches).toEqual([
      { channel: 'WHATSAPP', recipient: order.customerPhone },
      { channel: 'EMAIL', recipient: order.customerEmail },
    ]);
    expect(prisma.notificationLog.createMany).toHaveBeenCalledWith({
      data: [
        {
          triggerKey: 'ORDER_CONFIRMED',
          channel: 'WHATSAPP',
          recipient: order.customerPhone,
          orderId: order.id,
          status: 'SENT',
        },
        {
          triggerKey: 'ORDER_CONFIRMED',
          channel: 'EMAIL',
          recipient: order.customerEmail,
          orderId: order.id,
          status: 'SENT',
        },
      ],
    });
  });

  it('canais do body substituem os padrões do gatilho', async () => {
    const prisma = buildPrisma({ channelWhatsapp: true, channelEmail: true });

    const dispatches = await useCase(prisma).execute(order, OrderStatus.KIT_SHIPPED, ['SMS']);

    expect(dispatches).toEqual([{ channel: 'SMS', recipient: order.customerPhone }]);
  });

  it('gatilho desligado não gera log, mesmo com canais no body', async () => {
    const prisma = buildPrisma({ enabled: false });

    const dispatches = await useCase(prisma).execute(order, OrderStatus.PAID, ['EMAIL']);

    expect(dispatches).toEqual([]);
    expect(prisma.notificationLog.createMany).not.toHaveBeenCalled();
  });

  it('gatilho inexistente não gera log', async () => {
    const prisma = buildPrisma(null);

    const dispatches = await useCase(prisma).execute(order, OrderStatus.PAID);

    expect(dispatches).toEqual([]);
    expect(prisma.notificationLog.createMany).not.toHaveBeenCalled();
  });

  it('pula WhatsApp e SMS quando o pedido não tem telefone', async () => {
    const prisma = buildPrisma({ channelWhatsapp: true, channelEmail: true, channelSms: true });
    const semTelefone: NotifiableOrder = { ...order, customerPhone: null };

    const dispatches = await useCase(prisma).execute(semTelefone, OrderStatus.REPORT_READY);

    expect(dispatches).toEqual([{ channel: 'EMAIL', recipient: order.customerEmail }]);
  });

  it('não chama createMany quando nenhum canal tem destinatário', async () => {
    const prisma = buildPrisma({ channelWhatsapp: true, channelEmail: false, channelSms: true });
    const semTelefone: NotifiableOrder = { ...order, customerPhone: null };

    const dispatches = await useCase(prisma).execute(semTelefone, OrderStatus.PAID);

    expect(dispatches).toEqual([]);
    expect(prisma.notificationLog.createMany).not.toHaveBeenCalled();
  });
});
