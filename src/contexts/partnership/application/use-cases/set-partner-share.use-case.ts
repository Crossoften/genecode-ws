import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError, ValidationError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

export interface PartnerShareView {
  readonly id: string;
  readonly sharePercent: number;
}

/**
 * Muda a fatia de um parceiro pelo gerencial (GC-AJ-029).
 *
 * Pedido do teste assistido de 20/10: *"se a gente quiser aumentar de 20 para
 * 35%, onde eu mudo?"*. O schema já dizia que o admin podia mudar a fatia, mas
 * não havia tela nem rota.
 *
 * ### As duas travas da rede
 *
 * A regra que faz o split fechar (`domain/rede.ts`) é que **ninguém recebe mais
 * que o pai**. Mudar uma fatia não pode quebrá-la em nenhuma das pontas:
 *
 * - não passa da fatia do pai, se houver pai;
 * - não fica abaixo da maior fatia entre os filhos — baixar a raiz para 10
 *   com um filho em 15 faria a cadeia pagar mais do que o bolo.
 *
 * Quando a mudança esbarra num filho, ela é **recusada** com o nome de quem
 * impede, em vez de rebaixar a rede em cascata: mexer na fatia de outra pessoa
 * sem ela saber é decisão de negócio, não efeito colateral.
 *
 * Pedidos já pagos não mudam: o repasse congela a fatia no momento da venda.
 */
@Injectable()
export class SetPartnerShareUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    id: string,
    sharePercent: number,
    adminId: string,
  ): Promise<Result<PartnerShareView>> {
    const partner = await this.prisma.partner.findUnique({
      where: { id },
      select: {
        id: true,
        sharePercent: true,
        parent: { select: { displayName: true, sharePercent: true } },
        children: {
          select: { displayName: true, sharePercent: true },
          orderBy: { sharePercent: 'desc' },
          take: 1,
        },
      },
    });
    if (!partner) return fail(new NotFoundError('Parceiro não encontrado.'));

    const value = Math.round(sharePercent * 100) / 100;
    if (!Number.isFinite(value) || value <= 0 || value > 100) {
      return fail(
        new ValidationError('A porcentagem precisa ser maior que 0 e no máximo 100.', {
          fields: { sharePercent: 'Informe um valor entre 0,01 e 100.' },
        }),
      );
    }

    if (partner.parent && value > Number(partner.parent.sharePercent)) {
      const teto = Number(partner.parent.sharePercent);
      return fail(
        new ValidationError(
          `${value}% passa da fatia de quem indicou este parceiro (${partner.parent.displayName}, ${teto}%).`,
          { fields: { sharePercent: `O máximo para este parceiro é ${teto}%.` } },
        ),
      );
    }

    const maiorFilho = partner.children[0];
    if (maiorFilho && value < Number(maiorFilho.sharePercent)) {
      const piso = Number(maiorFilho.sharePercent);
      return fail(
        new ValidationError(
          `${value}% fica abaixo da fatia de um indicado (${maiorFilho.displayName}, ${piso}%). ` +
            'Ajuste os indicados primeiro.',
          { fields: { sharePercent: `O mínimo para este parceiro é ${piso}%.` } },
        ),
      );
    }

    const before = Number(partner.sharePercent);
    const [updated] = await this.prisma.$transaction([
      this.prisma.partner.update({ where: { id }, data: { sharePercent: value } }),
      this.prisma.auditLog.create({
        data: {
          userId: adminId,
          action: 'partner.share_changed',
          resource: 'partner',
          resourceId: id,
          metadata: { from: before, to: value },
        },
      }),
    ]);

    return ok({ id: updated.id, sharePercent: Number(updated.sharePercent) });
  }
}
