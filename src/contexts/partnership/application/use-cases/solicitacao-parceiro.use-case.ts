import { Injectable } from '@nestjs/common';
import { Prisma, type PartnerApplication, type PartnerType } from '@prisma/client';
import { cnpj, cpf } from 'cpf-cnpj-validator';

import { PrismaService } from '@infra/database/prisma.service';
import {
  ConflictError,
  DomainError,
  NotFoundError,
  ValidationError,
} from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';
import { validarChavePix } from '@shared/validation/chave-pix';

import { criarParceiro } from '../criar-parceiro';

/** O que a pessoa preenche no formulário curto do "Quero ser parceiro". */
export interface PedidoDeParceria {
  readonly type: PartnerType;
  /** Onde atua: academia, Instagram, consultório. */
  readonly channel: string;
  /** Só para quem atua como empresa, ou para conta que ainda não tem CPF. */
  readonly document?: string;
  /** Só para empresa: o nome que aparece no cupom e para o admin. */
  readonly displayName?: string;
  readonly pixKeyType?: string;
  readonly pixKey?: string;
  readonly note?: string;
}

/** Situação do pedido como a tela da própria pessoa enxerga. */
export interface MinhaSolicitacao {
  /** `PARTNER` quando a conta já é parceira, por qualquer caminho. */
  readonly status: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'PARTNER';
  readonly requestedAt: string | null;
  readonly decidedAt: string | null;
  /** Motivo da recusa, para a pessoa saber o que corrigir ao pedir de novo. */
  readonly decisionNote: string | null;
  /** Os dados da conta que o formulário reaproveita (só leitura na tela). */
  readonly perfil: {
    readonly name: string;
    readonly email: string;
    readonly document: string | null;
    readonly phone: string | null;
  };
}

/** Uma linha da fila do admin. */
export interface SolicitacaoAdmin {
  readonly id: string;
  readonly status: PartnerApplication['status'];
  readonly type: PartnerType;
  readonly displayName: string;
  readonly document: string;
  readonly channel: string;
  readonly pixKeyType: string | null;
  readonly pixKey: string | null;
  readonly note: string | null;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  readonly decisionNote: string | null;
  readonly conta: {
    readonly name: string;
    readonly email: string;
    readonly phone: string | null;
    /** Papéis que a conta já tem — o admin vê se é treinador. */
    readonly roles: readonly string[];
  } | null;
}

export interface DecisaoView {
  readonly id: string;
  readonly status: PartnerApplication['status'];
  readonly couponCode?: string;
}

const MENSAGEM_DOCUMENTO =
  'Não foi possível usar este documento. Confira os números ou fale com a gente.';

/**
 * "Seja parceiro" para quem já tem conta (GC-N05-14, reunião de 05/11).
 *
 * Até aqui o único caminho para virar parceiro era um cadastro novo — conta
 * duplicada, CPF duplicado. Agora o treinador ou o usuário pede com a conta
 * que já tem: o formulário reaproveita nome, CPF, e-mail e telefone e só pede
 * o que é de parceiro.
 *
 * ### A regra
 *
 * - **Pede, não vira.** O pedido fica `PENDING` e nada muda na conta. O papel
 *   `affiliate`, o cupom e o parceiro só nascem quando um admin aprova — o
 *   parceiro fala em nome da Genoa e tem contrato com academia; aprovação
 *   humana é obrigatória.
 * - **Um pedido aberto por conta.** Conferido aqui e garantido no banco pelo
 *   índice único de `pendingUserId`, para dois cliques seguidos não abrirem
 *   dois pedidos.
 * - **Decide uma vez só.** Aprovar ou recusar é um `updateMany` condicionado a
 *   `PENDING`: dois admins clicando juntos, um ganha e o outro recebe conflito.
 * - **Sem CPF duplicado.** Pessoa física usa o CPF da própria conta; um
 *   documento que já é de outra conta ou de outro parceiro é recusado.
 */
@Injectable()
export class SolicitacaoParceiroUseCase {
  constructor(private readonly prisma: PrismaService) {}

  /** Situação do pedido desta conta e os dados que o formulário reaproveita. */
  async minha(userId: string): Promise<Result<MinhaSolicitacao>> {
    const [user, parceiro, ultimo] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true, document: true, phone: true },
      }),
      this.prisma.partner.findUnique({ where: { userId }, select: { id: true } }),
      this.prisma.partnerApplication.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    if (!user) return fail(new NotFoundError('Conta não encontrada.'));

    return ok({
      status: parceiro ? 'PARTNER' : (ultimo?.status ?? 'NONE'),
      requestedAt: ultimo?.createdAt.toISOString() ?? null,
      decidedAt: ultimo?.decidedAt?.toISOString() ?? null,
      decisionNote: ultimo?.status === 'REJECTED' ? ultimo.decisionNote : null,
      perfil: user,
    });
  }

  /** Abre o pedido. Não dá papel nem cria cupom: isso é da aprovação. */
  async solicitar(userId: string, pedido: PedidoDeParceria): Promise<Result<MinhaSolicitacao>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, document: true },
    });
    if (!user) return fail(new NotFoundError('Conta não encontrada.'));

    if (await this.prisma.partner.findUnique({ where: { userId }, select: { id: true } })) {
      return fail(new ConflictError('Sua conta já é parceira.'));
    }
    const aberto = await this.prisma.partnerApplication.findUnique({
      where: { pendingUserId: userId },
      select: { id: true },
    });
    if (aberto) return fail(new ConflictError('Você já tem uma solicitação em análise.'));

    const channel = pedido.channel.trim();
    if (channel.length < 2) {
      return fail(
        new ValidationError('Conte onde você atua.', {
          fields: { channel: 'Conte onde você atua.' },
        }),
      );
    }

    // --- Documento: o da conta, sem duplicar ---------------------------------
    const documento = await this.resolverDocumento(user, pedido);
    if (documento.isFail()) return fail(documento.error);

    // --- Pix: opcional aqui; se veio, vem certo ------------------------------
    let pixKeyType: string | null = null;
    let pixKey: string | null = null;
    if (pedido.pixKey?.trim()) {
      const tipo = pedido.pixKeyType ?? '';
      const chave = validarChavePix(tipo, pedido.pixKey);
      if (!chave.valida) {
        const erro = chave.erro ?? 'Chave PIX inválida.';
        return fail(new ValidationError(erro, { fields: { pixKey: erro } }));
      }
      pixKeyType = tipo;
      pixKey = chave.normalizada;
    }

    const displayName =
      pedido.type === 'COMPANY' ? (pedido.displayName?.trim() ?? '') : user.name.trim();
    if (displayName.length < 2) {
      return fail(
        new ValidationError('Informe o nome da empresa.', {
          fields: { displayName: 'Informe o nome da empresa.' },
        }),
      );
    }

    try {
      await this.prisma.partnerApplication.create({
        data: {
          userId,
          pendingUserId: userId,
          type: pedido.type,
          displayName,
          document: documento.value,
          channel,
          pixKeyType,
          pixKey,
          note: pedido.note?.trim() || null,
        },
      });
    } catch (erro) {
      // Corrida de dois cliques: o índice único de `pendingUserId` segurou.
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
        return fail(new ConflictError('Você já tem uma solicitação em análise.'));
      }
      throw erro;
    }

    return this.minha(userId);
  }

  /** Fila do admin. Sem filtro, os pendentes primeiro e depois o histórico. */
  async listar(status?: PartnerApplication['status']): Promise<readonly SolicitacaoAdmin[]> {
    const pedidos = await this.prisma.partnerApplication.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const contas = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(pedidos.map((p) => p.userId))] } },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        roles: { select: { role: { select: { slug: true } } } },
      },
    });
    const contaPorId = new Map(contas.map((c) => [c.id, c]));

    const ordem = { PENDING: 0, APPROVED: 1, REJECTED: 1 } as const;
    return [...pedidos]
      .sort((a, b) => ordem[a.status] - ordem[b.status])
      .map((p) => {
        const conta = contaPorId.get(p.userId);
        return {
          id: p.id,
          status: p.status,
          type: p.type,
          displayName: p.displayName,
          document: p.document,
          channel: p.channel,
          pixKeyType: p.pixKeyType,
          pixKey: p.pixKey,
          note: p.note,
          createdAt: p.createdAt.toISOString(),
          decidedAt: p.decidedAt?.toISOString() ?? null,
          decisionNote: p.decisionNote,
          conta: conta
            ? {
                name: conta.name,
                email: conta.email,
                phone: conta.phone,
                roles: conta.roles.map((r) => r.role.slug),
              }
            : null,
        };
      });
  }

  /**
   * Aprova: o parceiro nasce com cupom e a conta ganha o papel `affiliate`,
   * somado aos que já tinha — o seletor de perfis passa a mostrar os dois.
   */
  async aprovar(id: string, adminId: string): Promise<Result<DecisaoView>> {
    try {
      const parceiro = await this.prisma.$transaction(async (tx) => {
        const pedido = await this.decidir(tx, id, adminId, 'APPROVED', null);

        if (
          await tx.partner.findUnique({ where: { userId: pedido.userId }, select: { id: true } })
        ) {
          // Virou parceiro por outro caminho enquanto o pedido esperava. O
          // throw desfaz a decisão: o pedido não fica "aprovado" sem parceiro.
          throw new ConflictError('Esta conta já é parceira.');
        }

        const criado = await criarParceiro(tx, {
          userId: pedido.userId,
          type: pedido.type,
          displayName: pedido.displayName,
          document: pedido.document,
          channel: pedido.channel,
          pixKeyType: pedido.pixKeyType,
          pixKey: pedido.pixKey,
        });

        await tx.partnerApplication.update({ where: { id }, data: { partnerId: criado.id } });
        await tx.auditLog.create({
          data: {
            userId: adminId,
            action: 'partner_application.approved',
            resource: 'partner_application',
            resourceId: id,
            metadata: { partnerId: criado.id, couponCode: criado.couponCode },
          },
        });
        return criado;
      });

      return ok({ id, status: 'APPROVED', couponCode: parceiro.couponCode });
    } catch (erro) {
      if (erro instanceof DomainError) return fail(erro);
      throw erro;
    }
  }

  /** Recusa. A pessoa vê o motivo e pode pedir de novo. */
  async recusar(id: string, adminId: string, motivo?: string): Promise<Result<DecisaoView>> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.decidir(tx, id, adminId, 'REJECTED', motivo?.trim() || null);
        await tx.auditLog.create({
          data: {
            userId: adminId,
            action: 'partner_application.rejected',
            resource: 'partner_application',
            resourceId: id,
          },
        });
      });
      return ok({ id, status: 'REJECTED' });
    } catch (erro) {
      if (erro instanceof DomainError) return fail(erro);
      throw erro;
    }
  }

  /**
   * Fecha o pedido se — e só se — ele ainda está em análise.
   *
   * O `updateMany` condicionado a `PENDING` é a trava contra decidir duas
   * vezes: ler, conferir e depois gravar deixaria dois admins aprovarem juntos.
   */
  private async decidir(
    tx: Prisma.TransactionClient,
    id: string,
    adminId: string,
    status: 'APPROVED' | 'REJECTED',
    decisionNote: string | null,
  ): Promise<PartnerApplication> {
    const fechado = await tx.partnerApplication.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status,
        pendingUserId: null,
        decidedAt: new Date(),
        decidedByUserId: adminId,
        decisionNote,
      },
    });

    const pedido = await tx.partnerApplication.findUnique({ where: { id } });
    if (!pedido) throw new NotFoundError('Solicitação não encontrada.');
    if (fechado.count === 0) throw new ConflictError('Esta solicitação já foi decidida.');
    return pedido;
  }

  /**
   * O documento do parceiro, sem duplicar ninguém.
   *
   * Pessoa física usa o CPF da conta: é o mesmo titular. Se a conta ainda não
   * tem CPF, a pessoa informa — e ele não pode ser de outra conta. Empresa
   * informa o CNPJ. Em todos os casos, documento que já é de outro parceiro é
   * recusado. A mensagem não diz de quem é, pelo mesmo motivo do cadastro:
   * a rota não pode virar verificador de quem é cliente do laboratório.
   */
  private async resolverDocumento(
    user: { readonly id: string; readonly document: string | null },
    pedido: PedidoDeParceria,
  ): Promise<Result<string>> {
    const informado = (pedido.document ?? '').replace(/\D/g, '');
    let documento: string;

    if (pedido.type === 'INDIVIDUAL') {
      const daConta = (user.document ?? '').replace(/\D/g, '');
      if (daConta) {
        // Com CPF na conta, o pedido não troca de titular.
        if (informado && informado !== daConta) {
          return fail(
            new ValidationError(MENSAGEM_DOCUMENTO, { fields: { document: MENSAGEM_DOCUMENTO } }),
          );
        }
        documento = daConta;
      } else {
        if (!cpf.isValid(informado)) {
          return fail(
            new ValidationError('Informe um CPF válido.', {
              fields: { document: 'Informe um CPF válido.' },
            }),
          );
        }
        const dono = await this.prisma.user.findFirst({
          where: { document: { in: [informado, mascarar(informado)] }, id: { not: user.id } },
          select: { id: true },
        });
        if (dono) {
          return fail(
            new ConflictError(MENSAGEM_DOCUMENTO, { fields: { document: MENSAGEM_DOCUMENTO } }),
          );
        }
        documento = informado;
      }
    } else {
      if (!cnpj.isValid(informado)) {
        return fail(
          new ValidationError('Informe um CNPJ válido.', {
            fields: { document: 'Informe um CNPJ válido.' },
          }),
        );
      }
      documento = informado;
    }

    // Parceiros antigos guardam o documento com máscara; confere as duas formas.
    const parceiroComDocumento = await this.prisma.partner.findFirst({
      where: { document: { in: [documento, mascarar(documento)] }, userId: { not: user.id } },
      select: { id: true },
    });
    if (parceiroComDocumento) {
      return fail(
        new ConflictError(MENSAGEM_DOCUMENTO, { fields: { document: MENSAGEM_DOCUMENTO } }),
      );
    }

    return ok(documento);
  }
}

/** `52998224725` → `529.982.247-25`; CNPJ com a máscara dele. */
function mascarar(digitos: string): string {
  if (digitos.length === 11) {
    return digitos.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (digitos.length === 14) {
    return digitos.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return digitos;
}
