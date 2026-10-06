import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { ConflictError, NotFoundError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

import { CodeValidation, validateActivationCode } from '../../domain/activation-code';

/**
 * Situações do pedido que ainda esperam um kit ser registrado.
 *
 * Serve só para **amarrar o registro ao pedido de quem comprou**, quando essa
 * pessoa é a mesma que registra. Não é condição para registrar: o kit pode ser
 * presente, e a esposa ou o filho registram o deles sem ter pedido nenhum —
 * caso que o cliente descreveu em 02/10.
 */
const PEDIDOS_ESPERANDO_KIT = ['PAID', 'KIT_SHIPPED', 'KIT_DELIVERED'] as const;

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
 * ### Validação em três camadas
 *
 * O dígito verificador pega erro de digitação — o código é lido de uma etiqueta
 * de papel. Mas passar no módulo 11 não prova nada sobre existência: cerca de 1
 * em cada 100 sequências aleatórias passa. Por isso a conferência contra a
 * **lista oficial da Genoa** é obrigatória e vem depois.
 *
 * ### É aqui que o número é queimado
 *
 * As etiquetas já estão impressas em papel antes de o sistema ver qualquer
 * uma: quem monta o kit pega um adesivo qualquer do monte, e o despacho não
 * registra qual foi. O sistema só descobre o número **quando a pessoa abre a
 * caixa e o digita** — e é nesse instante que ele sai da lista primitiva.
 * Achou, queimou.
 *
 * Por isso não existe kit esperando no banco: o kit **nasce** deste registro.
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

    // Camada 2: o número está na lista oficial da Genoa?
    const daLista = await this.prisma.activationCode.findUnique({ where: { code } });
    if (!daLista || !daLista.usable) {
      // Mensagem deliberadamente igual à de código malformado. Distinguir
      // "não está na lista" de "formato errado" entregaria, a quem varre, o
      // mapa de quais números existem.
      //
      // `usable: false` são os oito de base trivial: estão na lista do cliente,
      // passam no módulo 11, e o validador os recusa. Se um deles foi parar
      // numa caixa, o adesivo está errado e o suporte precisa saber.
      if (daLista && !daLista.usable) {
        this.logger.warn(
          `Registro recusado: ${code} é de base trivial e não deveria ter sido impresso`,
        );
      }
      return fail(new NotFoundError(CodeValidation.WRONG_CODE, { code: input.code }));
    }

    // Camada 3: este número já foi registrado por alguém?
    const kit = await this.prisma.kit.findUnique({ where: { code } });
    if (kit) {
      if (kit.status === 'DISCARDED') {
        return fail(new ConflictError('Este kit foi descartado. Fale com o suporte.'));
      }
      // Repetir o registro é idempotente — a pessoa pode ter perdido a tela ou
      // clicado duas vezes.
      if (kit.subjectId && kit.activatedByUserId === input.userId) {
        return ok({
          code,
          subjectId: kit.subjectId,
          alreadyActivated: true,
          activatedAt: kit.activatedAt ?? new Date(),
        });
      }
      // Por outra pessoa, não. É exatamente o risco que o cliente levantou: um
      // kit já vinculado a um DNA não pode mudar de dono.
      return fail(
        new ConflictError(
          'Este kit já foi registrado por outra pessoa. Se acredita que houve um engano, fale com o suporte.',
        ),
      );
    }

    // O pedido de quem está registrando, quando é a mesma pessoa que comprou.
    //
    // Serve para o acompanhamento do pedido andar junto. Não é exigência: o kit
    // pode ser presente, e a esposa ou o filho registram o deles sem ter pedido
    // — caso que o cliente descreveu em 02/10. Sem pedido, o registro acontece
    // do mesmo jeito e `orderId` fica nulo.
    const candidatos = await this.prisma.order.findMany({
      where: { userId: input.userId, status: { in: [...PEDIDOS_ESPERANDO_KIT] } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    // `Kit.orderId` é coluna solta, sem relação no Prisma: os pedidos que já
    // têm kit saem numa consulta à parte.
    const jaComKit = new Set(
      (
        await this.prisma.kit.findMany({
          where: { orderId: { in: candidatos.map((c) => c.id) } },
          select: { orderId: true },
        })
      ).map((k) => k.orderId),
    );
    const pedido = candidatos.find((c) => !jaComKit.has(c.id)) ?? null;

    const activatedAt = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const subject = await tx.subject.create({ data: { externalCode: code } });

      await tx.subjectLink.create({
        data: { userId: input.userId, subjectId: subject.id, relation: 'SELF' },
      });

      // O kit nasce aqui: antes deste registro ele só existia em papel.
      const criado = await tx.kit.create({
        data: {
          code,
          status: 'ACTIVATED',
          subjectId: subject.id,
          activatedByUserId: input.userId,
          activatedAt,
          orderId: pedido?.id ?? null,
        },
        select: { id: true },
      });

      // E o número sai da lista primitiva, no mesmo instante e na mesma
      // transação — senão sobra um kit sem baixa, ou uma baixa sem kit.
      await tx.activationCode.update({
        where: { code },
        data: { burnedAt: activatedAt, orderId: pedido?.id ?? null },
      });

      // Ativação de kit é acesso a dado genético: entra na trilha de auditoria.
      await tx.auditLog.create({
        data: {
          userId: input.userId,
          action: 'kit.activated',
          resource: 'kit',
          resourceId: criado.id,
          metadata: { code, sequencial: daLista.sequencial, orderId: pedido?.id ?? null },
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
      });

      return subject.id;
    });

    this.logger.log(`Kit ${code} registrado (sequencial ${daLista.sequencial} queimado)`);

    return ok({ code, subjectId: result, alreadyActivated: false, activatedAt });
  }
}
