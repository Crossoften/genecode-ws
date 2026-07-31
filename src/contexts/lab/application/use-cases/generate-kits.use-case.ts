import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';

import { PrismaService } from '@infra/database/prisma.service';
import { ValidationError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

import { buildActivationCode } from '../../domain/activation-code';

export interface GenerateKitsOutput {
  readonly batchReference: string;
  readonly generated: number;
  /** Amostra dos códigos, para conferência antes da impressão. */
  readonly sample: readonly string[];
}

/** Espaço de bases: 6 dígitos. */
const BASE_SPACE = 1_000_000;

/**
 * Gera um lote de kits com códigos únicos.
 *
 * Não existia em lugar nenhum — nem no protótipo do Admin, que tem tela de
 * pedidos e produtos mas nenhuma de kits, apesar de o cliente digitar o código
 * na Área do Paciente. Sem isto não há como imprimir uma caixa.
 *
 * ### Por que os códigos são aleatórios, e não sequenciais
 *
 * Sequencial permitiria a qualquer pessoa deduzir códigos válidos a partir de um
 * único kit em mãos — e como a validação do módulo 11 é determinística, os
 * dígitos verificadores viriam de brinde. Aleatório com `randomInt` do módulo
 * `crypto`, verificando colisão, torna a adivinhação inviável na prática.
 *
 * O espaço é de 1 milhão de bases. Vale monitorar a ocupação: acima de uns 30%,
 * a taxa de colisão começa a encarecer a geração, e a base precisará crescer.
 */
@Injectable()
export class GenerateKitsUseCase {
  private readonly logger = new Logger(GenerateKitsUseCase.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param quantity - Quantos kits gerar. Limitado a 5 000 por lote.
   * @param reference - Identificação do lote, para rastrear a produção.
   */
  async execute(quantity: number, reference: string): Promise<Result<GenerateKitsOutput>> {
    if (quantity < 1 || quantity > 5_000) {
      return fail(new ValidationError('Quantidade deve estar entre 1 e 5.000.'));
    }

    const existing = await this.prisma.kitBatch.findUnique({ where: { reference } });
    if (existing) {
      return fail(new ValidationError(`Já existe um lote com a referência "${reference}".`));
    }

    const used = new Set(
      (await this.prisma.kit.findMany({ select: { code: true } })).map((kit) =>
        kit.code.slice(0, 6),
      ),
    );

    if (used.size + quantity > BASE_SPACE * 0.9) {
      return fail(
        new ValidationError(
          'Espaço de códigos quase esgotado. A base de 6 dígitos precisa ser ampliada.',
        ),
      );
    }

    const codes: string[] = [];
    while (codes.length < quantity) {
      const base = String(randomInt(BASE_SPACE)).padStart(6, '0');
      if (used.has(base)) continue;
      used.add(base);
      codes.push(buildActivationCode(base));
    }

    const batch = await this.prisma.$transaction(async (tx) => {
      const created = await tx.kitBatch.create({ data: { reference } });
      await tx.kit.createMany({
        data: codes.map((code) => ({ code, batchId: created.id })),
      });
      return created;
    });

    this.logger.log(`Lote ${batch.reference}: ${quantity} kits gerados`);

    return ok({
      batchReference: batch.reference,
      generated: quantity,
      sample: codes.slice(0, 5),
    });
  }
}
