import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { ValidationError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

export interface EmitirKitsOutput {
  readonly batchReference: string;
  readonly generated: number;
  /** Amostra dos códigos, para conferência antes da impressão. */
  readonly sample: readonly string[];
  /** Primeiro e último sequencial da lista primitiva que este lote consumiu. */
  readonly sequencialInicial: number;
  readonly sequencialFinal: number;
  /** Quantos códigos sobraram na lista depois deste lote. */
  readonly restantes: number;
}

/** Teto por lote, herdado do gerador anterior: 5 000 etiquetas de uma vez. */
const MAXIMO_POR_LOTE = 5_000;

/**
 * Emite um lote de kits **queimando** códigos da lista primitiva da Genoa.
 *
 * ### O que isto substituiu, e por quê
 *
 * Até 06/10 este caso de uso **sorteava** bases com `randomInt` e montava o
 * código com o módulo 11. Parecia razoável e estava errado em dois níveis:
 *
 * 1. **Nenhum envelope do cliente ativava.** A Genoa produz os números — são as
 *    500 mil linhas da planilha que o Dr. Câmara descreveu em 02/10 — e imprime
 *    os adesivos a partir dela. Um código sorteado por nós não está no banco
 *    quando a pessoa o digita; um código da lista deles não está no banco
 *    nunca. Foi o que aconteceu com o `734233-00`, o 14º da lista: "Código
 *    Errado, Digite Novamente" com o envelope legítimo na mão.
 *
 * 2. **Os códigos colidiam com o papel.** A lista cobre metade do espaço de 6
 *    dígitos, e o sorteio caía nela cerca de metade das vezes — 13 dos 29 kits
 *    sorteados em homologação já estavam impressos em envelope da Genoa. Em
 *    produção seriam duas caixas físicas com o mesmo código, e quem ativasse
 *    por último ouviria que o kit é de outra pessoa.
 *
 * Agora a plataforma faz o que o cliente escreveu: *"na emissão do adesivo, a
 * plataforma 'queimará' um desses números fora da lista primitiva"*.
 *
 * ### Por que em ordem de sequencial
 *
 * Porque é a ordem em que a Genoa imprime. O primeiro lote de etiquetas são os
 * primeiros sequenciais, e é isso que faz o banco e o papel contarem a mesma
 * história. Não enfraquece nada: a lista **não está ordenada por código** — o
 * sequencial 1 é `557459-54` e o 2 é `618737-48` —, então ter um envelope em
 * mãos não revela o código do seguinte.
 */
@Injectable()
export class EmitirKitsUseCase {
  private readonly logger = new Logger(EmitirKitsUseCase.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param quantity - Quantas etiquetas emitir. Limitado a 5 000 por lote.
   * @param reference - Identificação do lote, para rastrear a produção.
   */
  async execute(quantity: number, reference: string): Promise<Result<EmitirKitsOutput>> {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAXIMO_POR_LOTE) {
      return fail(
        new ValidationError(
          `Quantidade deve estar entre 1 e ${MAXIMO_POR_LOTE.toLocaleString('pt-BR')}.`,
        ),
      );
    }

    const existing = await this.prisma.kitBatch.findUnique({ where: { reference } });
    if (existing) {
      return fail(new ValidationError(`Já existe um lote com a referência "${reference}".`));
    }

    const disponiveis = await this.prisma.activationCode.count({
      where: { burnedAt: null, usable: true },
    });
    if (disponiveis === 0) {
      return fail(
        new ValidationError(
          'A lista de códigos não foi importada, ou se esgotou. Rode `npm run seed:codigos`.',
        ),
      );
    }
    if (disponiveis < quantity) {
      return fail(
        new ValidationError(
          `A lista tem ${disponiveis.toLocaleString('pt-BR')} código(s) disponíveis, ` +
            `menos que os ${quantity.toLocaleString('pt-BR')} pedidos.`,
        ),
      );
    }

    const emitido = await this.prisma.$transaction(async (tx) => {
      // `FOR UPDATE` porque duas emissões simultâneas leriam a mesma fatia da
      // fila e sairiam com os mesmos códigos — dois lotes de etiquetas iguais,
      // descoberto só na impressão.
      const fila = await tx.$queryRaw<{ sequencial: number; code: string }[]>`
        SELECT sequencial, code
          FROM activation_codes
         WHERE burnedAt IS NULL AND usable = 1
         ORDER BY sequencial
         LIMIT ${quantity}
           FOR UPDATE
      `;
      if (fila.length < quantity) {
        throw new ValidationError('A lista se esgotou durante a emissão. Tente de novo.');
      }

      const batch = await tx.kitBatch.create({ data: { reference } });
      await tx.kit.createMany({
        data: fila.map((linha) => ({ code: linha.code, batchId: batch.id })),
      });
      await tx.activationCode.updateMany({
        where: { sequencial: { in: fila.map((linha) => linha.sequencial) } },
        data: { burnedAt: new Date(), batchId: batch.id },
      });

      return { batch, fila };
    });

    const { batch, fila } = emitido;
    const sequencialInicial = fila[0].sequencial;
    const sequencialFinal = fila[fila.length - 1].sequencial;

    this.logger.log(
      `Lote ${batch.reference}: ${quantity} códigos queimados ` +
        `(sequenciais ${sequencialInicial}–${sequencialFinal})`,
    );

    return ok({
      batchReference: batch.reference,
      generated: quantity,
      sample: fila.slice(0, 5).map((linha) => linha.code),
      sequencialInicial,
      sequencialFinal,
      restantes: disponiveis - quantity,
    });
  }
}
