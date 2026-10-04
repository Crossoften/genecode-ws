import { Injectable, Logger } from '@nestjs/common';

import { OrderStatusNotificationUseCase } from '@contexts/analytics/application/use-cases/order-status-notification.use-case';
import { ConflictError } from '@shared/domain/domain-error';
import { OrderStatus, canTransition } from '@contexts/ordering/domain/order-status';
import { PrismaService } from '@infra/database/prisma.service';

import type { OrderProgress } from '../../domain/ports/order-progress.port';

/**
 * Leva o pedido até "Laudo disponível" quando o laudo do titular é publicado.
 *
 * ### Por que dois eventos, e não um
 *
 * A máquina de estados não tem salto de `SAMPLE_RECEIVED` para `REPORT_READY` —
 * passa por `PROCESSING`. Forçar o salto exigiria abrir a transição, e abrir a
 * transição deixaria o admin mover um pedido de "amostra recebida" direto para
 * "laudo disponível" sem que nada tenha sido processado. Gravar os dois eventos
 * é mais fiel ao que de fato aconteceu: a amostra **foi** processada, e o
 * resultado **está** pronto. A linha do tempo do titular mostra as duas etapas,
 * como mostraria se um operador tivesse movido à mão.
 *
 * ### Por que nunca lança
 *
 * Quando isto roda, o laudo já está gravado. Uma falha aqui não pode derrubar a
 * linha do CSV: o laboratório veria "ignorada" e reenviaria um arquivo que já
 * entrou, criando a versão 2 de um laudo que ninguém pediu.
 */
@Injectable()
export class PrismaOrderProgressGateway implements OrderProgress {
  private readonly logger = new Logger(PrismaOrderProgressGateway.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: OrderStatusNotificationUseCase,
  ) {}

  async reportComputed(subjectId: string): Promise<void> {
    try {
      const kit = await this.prisma.kit.findFirst({
        where: { subjectId },
        select: { orderId: true },
      });
      // Titular sem kit é laudo sem pedido — acontece com as sementes antigas,
      // em que o código do CSV não era o código do kit. Não há o que acompanhar.
      if (!kit?.orderId) return;

      const order = await this.prisma.order.findUnique({
        where: { id: kit.orderId },
        select: { id: true, number: true, status: true, customerEmail: true, customerPhone: true },
      });
      if (!order) return;

      const caminho = rotaAteAnalise(order.status as OrderStatus);
      if (caminho.length === 0) {
        // Já passou de "Em análise" (reenvio do mesmo CSV), ou está cancelado,
        // ou num estado anterior ao envio da amostra. Em nenhum deles o avanço
        // automático seria verdade.
        return;
      }

      for (const destino of caminho) {
        await this.prisma.$transaction([
          this.prisma.order.update({ where: { id: order.id }, data: { status: destino } }),
          this.prisma.orderEvent.create({
            data: { orderId: order.id, status: destino, actor: 'laboratorio' },
          }),
        ]);
      }

      // Sem aviso ao cliente: o laudo ainda não foi conferido, e não há o que
      // avisar. O aviso sai na liberação (decisão do Camara em 02/10).
      this.logger.log(
        `Pedido ${order.number}: ${order.status} → PROCESSING pela importação; ` +
          'o laudo aguarda conferência.',
      );
    } catch (erro) {
      this.logger.error(
        `Laudo publicado para o titular ${subjectId}, mas o pedido não avançou: ${
          erro instanceof Error ? erro.message : String(erro)
        }`,
      );
    }
  }

  /**
   * Alguém conferiu e liberou: o pedido vai a "Laudo disponível" e o cliente é
   * avisado.
   *
   * Ao contrário do `reportComputed`, aqui **pode lançar**. O laudo e o pedido
   * têm de virar juntos: publicar o laudo e deixar o pedido para trás é o
   * defeito de 01/10 de volta, com o titular vendo o botão cinza.
   */
  async reportReleased(subjectId: string, actor: string): Promise<void> {
    const kit = await this.prisma.kit.findFirst({
      where: { subjectId },
      select: { orderId: true },
    });
    // Laudo sem kit é laudo sem pedido — acontece nas sementes antigas. Não há
    // pedido para avançar, e isso não impede a liberação do laudo.
    if (!kit?.orderId) return;

    const order = await this.prisma.order.findUnique({
      where: { id: kit.orderId },
      select: { id: true, number: true, status: true, customerEmail: true, customerPhone: true },
    });
    if (!order) return;

    const atual = order.status as OrderStatus;
    if (atual === OrderStatus.REPORT_READY) return;

    if (!canTransition(atual, OrderStatus.REPORT_READY)) {
      throw new ConflictError(
        `O pedido ${order.number} está em "${atual}" e não pode ir para "Laudo disponível".`,
        { from: atual },
      );
    }

    await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.REPORT_READY },
      }),
      this.prisma.orderEvent.create({
        data: {
          orderId: order.id,
          status: OrderStatus.REPORT_READY,
          actor,
          note: 'Laudo conferido e liberado.',
        },
      }),
    ]);

    await this.notify.execute(
      { id: order.id, customerEmail: order.customerEmail, customerPhone: order.customerPhone },
      OrderStatus.REPORT_READY,
    );

    this.logger.log(`Pedido ${order.number}: liberado por ${actor}; cliente avisado.`);
  }
}

/**
 * Sequência de estados até "Em análise", ou vazio quando não cabe avançar.
 *
 * Cada passo é conferido com `canTransition` em vez de escrito à mão: se alguém
 * mudar a máquina de estados, isto para de avançar em vez de gravar um histórico
 * que a máquina não permitiria.
 */
function rotaAteAnalise(atual: OrderStatus): OrderStatus[] {
  // Já está em análise ou além: não há o que avançar.
  if (atual === OrderStatus.PROCESSING || atual === OrderStatus.REPORT_READY) return [];

  for (const caminho of [[OrderStatus.PROCESSING]]) {
    // Anotado: sem isto o `atual` chega aqui já estreitado pelo `return` acima,
    // e o compilador recusa atribuir REPORT_READY à variável.
    let de: OrderStatus = atual;
    const valido = caminho.every((para) => {
      const ok = canTransition(de, para);
      de = para;
      return ok;
    });
    if (valido) return caminho;
  }

  return [];
}
