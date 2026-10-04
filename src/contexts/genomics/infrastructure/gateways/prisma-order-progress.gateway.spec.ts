import type { OrderStatusNotificationUseCase } from '@contexts/analytics/application/use-cases/order-status-notification.use-case';
import { OrderStatus } from '@contexts/ordering/domain/order-status';
import type { PrismaService } from '@infra/database/prisma.service';

import { PrismaOrderProgressGateway } from './prisma-order-progress.gateway';

/**
 * O avanço automático do pedido fecha a pendência 19b, e é ele que separa
 * "laudo publicado" de "laudo que o titular consegue abrir". Três coisas não
 * podem escorregar: passar por PROCESSING em vez de saltar, não reabrir pedido
 * que já está em REPORT_READY, e nunca lançar — o laudo já está gravado quando
 * isto roda.
 */
describe('PrismaOrderProgressGateway', () => {
  const PEDIDO = {
    id: 'pedido-1',
    number: 'GC-LAB-0001',
    status: OrderStatus.SAMPLE_RECEIVED,
    customerEmail: 'paciente01@teste.com',
    customerPhone: null,
  };

  function montar(pedido: typeof PEDIDO | null = PEDIDO, kit: { orderId: string | null } | null = { orderId: 'pedido-1' }) {
    const atualizacoes: unknown[] = [];
    const eventos: unknown[] = [];

    const prisma = {
      kit: { findFirst: jest.fn(async () => kit) },
      order: {
        findUnique: jest.fn(async () => pedido),
        update: jest.fn((args: unknown) => {
          atualizacoes.push(args);
          return args;
        }),
      },
      orderEvent: {
        create: jest.fn((args: unknown) => {
          eventos.push(args);
          return args;
        }),
      },
      $transaction: jest.fn(async (ops: unknown[]) => ops),
    } as unknown as PrismaService;

    const notificar = { execute: jest.fn(async () => []) } as unknown as OrderStatusNotificationUseCase;

    return {
      gateway: new PrismaOrderProgressGateway(prisma, notificar),
      prisma,
      notificar,
      atualizacoes,
      eventos,
    };
  }

  /** Estados gravados, na ordem. */
  function estados(registros: unknown[]): string[] {
    return registros.map((r) => (r as { data: { status: string } }).data.status);
  }

  describe('reportComputed — o laboratório calculou, ninguém conferiu ainda', () => {
    it('leva de amostra recebida até EM ANÁLISE, e para aí', async () => {
      const { gateway, atualizacoes, eventos, notificar } = montar();

      await gateway.reportComputed('titular-1');

      expect(estados(atualizacoes)).toEqual([OrderStatus.PROCESSING]);
      expect(estados(eventos)).toEqual([OrderStatus.PROCESSING]);
      // O cliente NÃO é avisado: não há o que avisar enquanto ninguém conferiu.
      expect(notificar.execute).not.toHaveBeenCalled();
    });

    it('já em análise, não repete a etapa', async () => {
      const { gateway, atualizacoes } = montar({ ...PEDIDO, status: OrderStatus.PROCESSING });

      await gateway.reportComputed('titular-1');

      expect(atualizacoes).toHaveLength(0);
    });

    it('o evento é atribuído ao laboratório, não ao sistema', async () => {
      const { gateway, eventos } = montar();

      await gateway.reportComputed('titular-1');

      for (const evento of eventos) {
        expect((evento as { data: { actor: string } }).data.actor).toBe('laboratorio');
      }
    });

    it('não mexe em pedido que já está com o laudo disponível', async () => {
      const { gateway, atualizacoes, notificar } = montar({
        ...PEDIDO,
        status: OrderStatus.REPORT_READY,
      });

      await gateway.reportComputed('titular-1');

      expect(atualizacoes).toHaveLength(0);
      expect(notificar.execute).not.toHaveBeenCalled();
    });

    it('não força pedido cancelado', async () => {
      const { gateway, atualizacoes } = montar({ ...PEDIDO, status: OrderStatus.CANCELLED });

      await gateway.reportComputed('titular-1');

      expect(atualizacoes).toHaveLength(0);
    });

    // Laudo gerado por CSV cujo código não é de kit nenhum — é o caso das
    // sementes antigas, e não há pedido para acompanhar.
    it('ignora titular sem kit', async () => {
      const { gateway, prisma, atualizacoes } = montar(PEDIDO, null);

      await gateway.reportComputed('titular-orfao');

      expect(prisma.order.findUnique).not.toHaveBeenCalled();
      expect(atualizacoes).toHaveLength(0);
    });

    it('engole a falha do banco: o laudo já está gravado', async () => {
      const { gateway, prisma } = montar();
      (prisma.kit.findFirst as jest.Mock).mockRejectedValueOnce(new Error('conexão caiu'));

      await expect(gateway.reportComputed('titular-1')).resolves.toBeUndefined();
    });
  });

  describe('reportReleased — alguém conferiu e liberou', () => {
    it('leva a LAUDO DISPONÍVEL e avisa o cliente', async () => {
      const { gateway, atualizacoes, eventos, notificar } = montar({
        ...PEDIDO,
        status: OrderStatus.PROCESSING,
      });

      await gateway.reportReleased('titular-1', 'admin-1');

      expect(estados(atualizacoes)).toEqual([OrderStatus.REPORT_READY]);
      expect(estados(eventos)).toEqual([OrderStatus.REPORT_READY]);
      expect(notificar.execute).toHaveBeenCalledTimes(1);
    });

    it('o evento guarda QUEM liberou', async () => {
      const { gateway, eventos } = montar({ ...PEDIDO, status: OrderStatus.PROCESSING });

      await gateway.reportReleased('titular-1', 'admin-7');

      expect((eventos[0] as { data: { actor: string } }).data.actor).toBe('admin-7');
    });

    it('liberar de novo não avisa o cliente duas vezes', async () => {
      const { gateway, atualizacoes, notificar } = montar({
        ...PEDIDO,
        status: OrderStatus.REPORT_READY,
      });

      await gateway.reportReleased('titular-1', 'admin-1');

      expect(atualizacoes).toHaveLength(0);
      expect(notificar.execute).not.toHaveBeenCalled();
    });

    // Aqui, ao contrário do reportComputed, a falha SOBE: publicar o laudo e
    // deixar o pedido para trás devolveria o defeito de 01/10, com o titular
    // vendo o botão cinza.
    it('recusa quando a máquina de estados não permite', async () => {
      const { gateway } = montar({ ...PEDIDO, status: OrderStatus.CANCELLED });

      await expect(gateway.reportReleased('titular-1', 'admin-1')).rejects.toThrow(
        /não pode ir para/i,
      );
    });
  });
});
