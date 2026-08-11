import { Injectable } from '@nestjs/common';
import { NotificationTriggerKey } from '@prisma/client';

import { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError, ValidationError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

import { toTriggerView, type TriggerView } from '../notification-trigger.view';

export interface UpdateTriggerInput {
  readonly enabled?: boolean;
  readonly template?: string;
  readonly channels?: {
    readonly whatsapp?: boolean;
    readonly email?: boolean;
    readonly sms?: boolean;
  };
}

/**
 * Partially updates one notification trigger: toggle, template text or
 * channels — the inline edits of the notifications screen.
 */
@Injectable()
export class UpdateNotificationTriggerUseCase {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Applies the given partial update to the trigger identified by `key`.
   *
   * An invalid key and a valid-but-unseeded key return the same NOT_FOUND, so
   * the response never reveals which enum values exist.
   */
  async execute(key: string, input: UpdateTriggerInput): Promise<Result<TriggerView>> {
    if (!Object.values(NotificationTriggerKey).includes(key as NotificationTriggerKey)) {
      return fail(new NotFoundError('Gatilho não encontrado.'));
    }

    if (input.template !== undefined && input.template.trim().length === 0) {
      return fail(new ValidationError('O texto-modelo não pode ser vazio.'));
    }

    const triggerKey = key as NotificationTriggerKey;
    const existing = await this.prisma.notificationTrigger.findUnique({
      where: { key: triggerKey },
    });
    if (!existing) return fail(new NotFoundError('Gatilho não encontrado.'));

    const updated = await this.prisma.notificationTrigger.update({
      where: { key: triggerKey },
      data: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.template !== undefined ? { template: input.template } : {}),
        ...(input.channels?.whatsapp !== undefined
          ? { channelWhatsapp: input.channels.whatsapp }
          : {}),
        ...(input.channels?.email !== undefined ? { channelEmail: input.channels.email } : {}),
        ...(input.channels?.sms !== undefined ? { channelSms: input.channels.sms } : {}),
      },
    });

    return ok(toTriggerView(updated));
  }
}
