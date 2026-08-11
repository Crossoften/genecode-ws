import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { ConflictError, NotFoundError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

import { validateActivationCode } from '../../domain/activation-code';

export interface ActivateKitInput {
  readonly code: string;
  /** Conta que está ativando. Vira o titular, salvo indicação contrária. */
  readonly userId: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

export interface ActivateKitOutput {
  readonly code: string;
  readonly subjectId: string;
  readonly alreadyActivated: boolean;
  /** Quando o vínculo aconteceu — a confirmação do wizard exibe, não inventa. */
  readonly activatedAt: Date;
}

/**
 * Ativa o kit e define o titular do dado genético.
 *
 * É o passo que o cliente qualificou duas vezes como "importantíssimo", e a
 * justificativa dele é a razão de todo o cuidado abaixo:
 *
 * > *"Ele vai registrar o kit no nome dele para não ter problema que esse exame,
 * > que o DNA que seja colhido depois, vá pro DNA de uma outra pessoa e a gente
 * > acabe entregando o resultado de uma pessoa para outra. E aí é uma super
 * > complicação porque a gente tá falando de DNA."*
 *
 * ### Por que o titular é quem ativa, não quem comprou
 *
 * O kit pode ser presente. Quem ativa é quem vai coletar, e é essa pessoa que o
 * laudo pertence. Amarrar o titular ao comprador entregaria o resultado à pessoa
 * errada exatamente no caso que o cliente mais destacou.
 *
 * ### Validação em duas camadas
 *
 * O dígito verificador pega erro de digitação — o código é lido de uma etiqueta
 * de papel. Mas passar no módulo 11 não prova nada sobre existência: cerca de 1
 * em cada 100 sequências aleatórias passa. Por isso a checagem no banco é
 * obrigatória e vem depois.
 */
@Injectable()
export class ActivateKitUseCase {
  private readonly logger = new Logger(ActivateKitUseCase.name);

  constructor(private readonly prisma: PrismaService) {}

  async execute(input: ActivateKitInput): Promise<Result<ActivateKitOutput>> {
    // Camada 1: o código é bem formado?
    const validated = validateActivationCode(input.code);
    if (validated.isFail()) return fail(validated.error);

    const code = validated.value;

    // Camada 2: o código existe e está disponível?
    const kit = await this.prisma.kit.findUnique({ where: { code } });
    if (!kit) {
      // Mensagem deliberadamente igual à de código malformado. Distinguir
      // "não existe" de "formato errado" permitiria varrer o espaço de códigos
      // para descobrir quais foram emitidos.
      return fail(new NotFoundError('Código Errado, Digite Novamente.', { code: input.code }));
    }

    if (kit.status === 'DISCARDED') {
      return fail(new ConflictError('Este kit foi descartado. Fale com o suporte.'));
    }

    if (kit.subjectId) {
      // Reativação pelo mesmo titular é idempotente — o cliente pode ter perdido
      // a tela ou clicado duas vezes.
      if (kit.activatedByUserId === input.userId) {
        return ok({
          code,
          subjectId: kit.subjectId,
          alreadyActivated: true,
          activatedAt: kit.activatedAt ?? new Date(),
        });
      }
      // Por outra pessoa, não. Aqui está justamente o risco que o cliente
      // levantou: um kit já vinculado a um DNA não pode mudar de dono.
      return fail(
        new ConflictError(
          'Este kit já foi ativado por outra pessoa. Se acredita que houve um engano, fale com o suporte.',
        ),
      );
    }

    const activatedAt = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const subject = await tx.subject.create({ data: { externalCode: code } });

      await tx.subjectLink.create({
        data: { userId: input.userId, subjectId: subject.id, relation: 'SELF' },
      });

      await tx.kit.update({
        where: { id: kit.id },
        data: {
          status: 'ACTIVATED',
          subjectId: subject.id,
          activatedByUserId: input.userId,
          activatedAt,
        },
      });

      // Ativação de kit é acesso a dado genético: entra na trilha de auditoria.
      await tx.auditLog.create({
        data: {
          userId: input.userId,
          action: 'kit.activated',
          resource: 'kit',
          resourceId: kit.id,
          metadata: { code },
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
      });

      return subject.id;
    });

    this.logger.log(`Kit ${code} ativado`);

    return ok({ code, subjectId: result, alreadyActivated: false, activatedAt });
  }
}
