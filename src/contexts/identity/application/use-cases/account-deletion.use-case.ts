import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '@infra/database/prisma.service';
import type { Env } from '@shared/config/env.schema';
import { NotFoundError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

import { NOTIFICATION_SENDER, type NotificationSender } from '../../domain/ports/notification.port';

export interface DeletionRequestView {
  readonly id: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly handledAt: Date | null;
}

/**
 * Pedido de exclusão de conta (GC-AJ-006, rodapé "Excluir conta").
 *
 * Registra o pedido e avisa as duas pontas: o titular recebe a confirmação, e
 * o canal de privacidade da Genoa (`PRIVACY_CONTACT_EMAIL`, quando configurado)
 * recebe o pedido para avaliar. Nada é apagado aqui — a política diz que os
 * pedidos são avaliados, e o laudo tem guarda legal.
 *
 * Pedir de novo com um pedido aberto devolve o mesmo pedido: não se empilham
 * pedidos iguais, e a data que conta para o prazo é a do primeiro.
 */
@Injectable()
export class AccountDeletionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFICATION_SENDER) private readonly notifications: NotificationSender,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async request(
    userId: string,
    reason: string | undefined,
    ipAddress?: string,
  ): Promise<Result<DeletionRequestView>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });
    if (!user) return fail(new NotFoundError('Conta não encontrada.'));

    const open = await this.prisma.accountDeletionRequest.findFirst({
      where: { userId, status: 'OPEN' },
    });
    if (open) return ok(view(open));

    const created = await this.prisma.accountDeletionRequest.create({
      data: { userId, reason: reason?.trim() || null },
    });
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'account.deletion_requested',
        resource: 'user',
        resourceId: userId,
        ipAddress,
      },
    });

    const firstName = user.name.trim().split(/\s+/)[0] ?? user.name;
    await this.notifications.send(user.email, { kind: 'deletion-requested', name: firstName });

    const privacy = this.config.get('PRIVACY_CONTACT_EMAIL', { infer: true });
    if (privacy) {
      await this.notifications.send(privacy, {
        kind: 'deletion-request-received',
        name: user.name,
        email: user.email,
        reason: created.reason,
        requestId: created.id,
      });
    }

    return ok(view(created));
  }

  /** O pedido aberto mais recente, para a tela não oferecer pedir de novo. */
  async current(userId: string): Promise<DeletionRequestView | null> {
    const latest = await this.prisma.accountDeletionRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return latest ? view(latest) : null;
  }
}

function view(request: {
  id: string;
  status: string;
  createdAt: Date;
  handledAt: Date | null;
}): DeletionRequestView {
  return {
    id: request.id,
    status: request.status,
    createdAt: request.createdAt,
    handledAt: request.handledAt,
  };
}
