import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { ConflictError, NotFoundError, ValidationError } from '@shared/domain/domain-error';
import { fail, ok, okVoid, type Result } from '@shared/domain/result';

import {
  NIVEL_MAXIMO,
  podeConvidar,
  validarFatiaDoFilho,
  validarNivel,
} from '../../domain/rede';

/** Validade do convite. Curta de propósito: fatia combinada não fica em aberto. */
const VALIDADE_DIAS = 14;

export interface ConviteCriado {
  readonly id: string;
  /** Token em claro — só existe aqui e no link. Nunca é guardado assim. */
  readonly token: string;
  readonly sharePercent: number;
  readonly label: string | null;
  readonly expiresAt: Date;
}

export interface ConviteResumo {
  readonly id: string;
  readonly sharePercent: number;
  readonly label: string | null;
  readonly expiresAt: Date;
  readonly situacao: 'ABERTO' | 'ACEITO' | 'EXPIRADO' | 'REVOGADO';
  readonly aceitoPor: string | null;
  readonly aceitoEm: Date | null;
}

const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * Convite de um parceiro para outro entrar na rede abaixo dele.
 *
 * Quem convida decide a fatia do convidado no ato — é a regra da rede: cada
 * parceiro reparte a própria fatia com quem está abaixo (ver `domain/rede.ts`).
 * A fatia fica congelada no convite: mudá-la depois do aceite mexeria em
 * repasse já combinado.
 *
 * O token vai no link e é guardado **só como hash**. Com o id do parceiro na
 * URL, qualquer um montaria um link se pendurando na rede de quem quisesse.
 */
@Injectable()
export class ConvidarParceiroUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async criar(
    userId: string,
    entrada: { sharePercent: number; label?: string },
  ): Promise<Result<ConviteCriado>> {
    const quemConvida = await this.prisma.partner.findUnique({ where: { userId } });
    if (!quemConvida) return fail(new NotFoundError('Perfil de parceiro não encontrado.'));
    if (!quemConvida.active) {
      return fail(new ConflictError('Parceiro inativo não convida.'));
    }

    if (!podeConvidar(quemConvida.level)) {
      return fail(
        new ConflictError(
          `A rede vai até o ${NIVEL_MAXIMO}º nível, e você já está nele. ` +
            'Este nível não convida novos parceiros.',
        ),
      );
    }

    const fatiaDoPai = Number(quemConvida.sharePercent);
    const valida = validarFatiaDoFilho(fatiaDoPai, entrada.sharePercent);
    if (valida.isFail()) return fail(valida.error);

    // 256 bits em base64url: o mesmo padrão do token de redefinição de senha.
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + VALIDADE_DIAS * 86_400_000);

    const convite = await this.prisma.partnerInvite.create({
      data: {
        partnerId: quemConvida.id,
        tokenHash: hash(token),
        sharePercent: entrada.sharePercent,
        label: entrada.label?.trim() || null,
        expiresAt,
      },
    });

    return ok({
      id: convite.id,
      token,
      sharePercent: Number(convite.sharePercent),
      label: convite.label,
      expiresAt: convite.expiresAt,
    });
  }

  /** Convites que este parceiro enviou, para a tela de rede. */
  async listar(userId: string): Promise<Result<readonly ConviteResumo[]>> {
    const parceiro = await this.prisma.partner.findUnique({ where: { userId } });
    if (!parceiro) return fail(new NotFoundError('Perfil de parceiro não encontrado.'));

    const convites = await this.prisma.partnerInvite.findMany({
      where: { partnerId: parceiro.id },
      include: { acceptedByPartner: { select: { displayName: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const agora = new Date();
    return ok(
      convites.map((c) => ({
        id: c.id,
        sharePercent: Number(c.sharePercent),
        label: c.label,
        expiresAt: c.expiresAt,
        situacao: c.revokedAt
          ? ('REVOGADO' as const)
          : c.acceptedAt
            ? ('ACEITO' as const)
            : c.expiresAt < agora
              ? ('EXPIRADO' as const)
              : ('ABERTO' as const),
        aceitoPor: c.acceptedByPartner?.displayName ?? null,
        aceitoEm: c.acceptedAt,
      })),
    );
  }

  async revogar(userId: string, conviteId: string): Promise<Result<void>> {
    const parceiro = await this.prisma.partner.findUnique({ where: { userId } });
    if (!parceiro) return fail(new NotFoundError('Perfil de parceiro não encontrado.'));

    const alterados = await this.prisma.partnerInvite.updateMany({
      where: { id: conviteId, partnerId: parceiro.id, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (alterados.count === 0) {
      return fail(new NotFoundError('Convite não encontrado, ou já aceito.'));
    }
    return okVoid();
  }

  /**
   * Lê o convite pelo token, para a tela de aceite mostrar quem convidou e
   * qual a fatia — antes de a pessoa decidir.
   */
  async consultar(token: string): Promise<Result<{
    quemConvidou: string;
    sharePercent: number;
    nivel: number;
    label: string | null;
  }>> {
    const convite = await this.prisma.partnerInvite.findUnique({
      where: { tokenHash: hash(token) },
      include: { partner: true },
    });
    if (!convite) return fail(new NotFoundError('Convite não encontrado.'));
    if (convite.revokedAt) return fail(new ConflictError('Este convite foi cancelado.'));
    if (convite.acceptedAt) return fail(new ConflictError('Este convite já foi usado.'));
    if (convite.expiresAt < new Date()) return fail(new ConflictError('Este convite expirou.'));

    const nivel = validarNivel(convite.partner.level);
    if (nivel.isFail()) return fail(nivel.error);

    return ok({
      quemConvidou: convite.partner.displayName,
      sharePercent: Number(convite.sharePercent),
      nivel: nivel.value,
      label: convite.label,
    });
  }

  /**
   * Resolve o convite no momento do cadastro.
   *
   * Devolve o que o novo parceiro herda: pai, nível e fatia. A conferência é
   * refeita aqui, e não só na consulta: entre ver a tela e enviar o formulário,
   * o convite pode ter sido revogado ou o pai pode ter mudado de nível.
   */
  async resolverParaCadastro(token: string): Promise<Result<{
    conviteId: string;
    parentId: string;
    level: number;
    sharePercent: number;
  }>> {
    const convite = await this.prisma.partnerInvite.findUnique({
      where: { tokenHash: hash(token) },
      include: { partner: true },
    });
    if (!convite) return fail(new NotFoundError('Convite não encontrado.'));
    if (convite.revokedAt) return fail(new ConflictError('Este convite foi cancelado.'));
    if (convite.acceptedAt) return fail(new ConflictError('Este convite já foi usado.'));
    if (convite.expiresAt < new Date()) return fail(new ConflictError('Este convite expirou.'));

    const nivel = validarNivel(convite.partner.level);
    if (nivel.isFail()) return fail(nivel.error);

    // A fatia do pai pode ter mudado depois do convite — se encolheu abaixo do
    // prometido, o convite não vale mais do que o pai tem para dar.
    const fatiaDoPai = Number(convite.partner.sharePercent);
    const fatia = Number(convite.sharePercent);
    if (fatia > fatiaDoPai) {
      return fail(
        new ValidationError(
          'A fatia deste convite não cabe mais na rede de quem convidou. ' +
            'Peça um convite novo.',
        ),
      );
    }

    return ok({
      conviteId: convite.id,
      parentId: convite.partnerId,
      level: nivel.value,
      sharePercent: fatia,
    });
  }
}
