import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

export interface PartnerActiveView {
  readonly id: string;
  readonly active: boolean;
}

/** Activates or deactivates a partner from the admin table (tela adm-6). */
@Injectable()
export class SetPartnerActiveUseCase {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sets the partner's active flag.
   *
   * @param id - Partner id.
   * @param active - Desired state.
   */
  async execute(id: string, active: boolean): Promise<Result<PartnerActiveView>> {
    const partner = await this.prisma.partner.findUnique({ where: { id } });
    if (!partner) return fail(new NotFoundError('Parceiro não encontrado.'));

    const updated = await this.prisma.partner.update({ where: { id }, data: { active } });
    return ok({ id: updated.id, active: updated.active });
  }
}
