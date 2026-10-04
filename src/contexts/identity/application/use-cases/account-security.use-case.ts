import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError } from '@shared/domain/domain-error';
import { fail, ok, okVoid, type Result } from '@shared/domain/result';

export interface SessaoAtiva {
  readonly id: string;
  readonly dispositivo: string;
  readonly ip: string | null;
  readonly criadaEm: Date;
  readonly expiraEm: Date;
  readonly atual: boolean;
}

export interface PreferenciasAviso {
  readonly email: boolean;
  readonly whatsapp: boolean;
  readonly sms: boolean;
}

/**
 * Segurança e avisos da própria conta — o conteúdo que faltava nas abas
 * "Segurança" e "Notificações" do perfil do titular (GEN-13).
 *
 * Nada aqui inventa armazenamento: as sessões já viviam em `RefreshToken`,
 * com `userAgent` e `ipAddress` gravados desde a Onda 0, e as preferências são
 * três colunas no próprio usuário.
 */
@Injectable()
export class AccountSecurityUseCase {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sessões vivas da conta.
   *
   * Só as que ainda valem: revogada ou expirada não é sessão, é histórico — e
   * listar histórico como se fosse acesso ativo assusta sem motivo.
   */
  async sessoes(userId: string, hashAtual?: string): Promise<Result<readonly SessaoAtiva[]>> {
    const tokens = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return ok(
      tokens.map((token) => ({
        id: token.id,
        dispositivo: descreverDispositivo(token.userAgent),
        ip: token.ipAddress,
        criadaEm: token.createdAt,
        expiraEm: token.expiresAt,
        atual: hashAtual !== undefined && token.tokenHash === hashAtual,
      })),
    );
  }

  /** Encerra uma sessão específica. Só as próprias — o filtro inclui o userId. */
  async encerrarSessao(userId: string, sessaoId: string): Promise<Result<void>> {
    const alterados = await this.prisma.refreshToken.updateMany({
      where: { id: sessaoId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (alterados.count === 0) return fail(new NotFoundError('Sessão não encontrada.'));
    return okVoid();
  }

  async preferencias(userId: string): Promise<Result<PreferenciasAviso>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { notifyEmail: true, notifyWhatsapp: true, notifySms: true },
    });
    if (!user) return fail(new NotFoundError('Conta não encontrada.'));
    return ok({ email: user.notifyEmail, whatsapp: user.notifyWhatsapp, sms: user.notifySms });
  }

  async salvarPreferencias(
    userId: string,
    entrada: Partial<PreferenciasAviso>,
  ): Promise<Result<PreferenciasAviso>> {
    const dados: Record<string, boolean> = {};
    if (entrada.email !== undefined) dados.notifyEmail = entrada.email;
    if (entrada.whatsapp !== undefined) dados.notifyWhatsapp = entrada.whatsapp;
    if (entrada.sms !== undefined) dados.notifySms = entrada.sms;

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: dados,
      select: { notifyEmail: true, notifyWhatsapp: true, notifySms: true },
    });
    return ok({ email: user.notifyEmail, whatsapp: user.notifyWhatsapp, sms: user.notifySms });
  }
}

/**
 * Nome legível do dispositivo a partir do user agent.
 *
 * Deliberadamente grosseiro: a pessoa precisa reconhecer "foi meu celular" ou
 * "isto não fui eu". Exibir o user agent cru não ajuda ninguém a decidir isso.
 */
function descreverDispositivo(userAgent: string | null): string {
  if (!userAgent) return 'Dispositivo desconhecido';
  const ua = userAgent.toLowerCase();

  const sistema = ua.includes('iphone')
    ? 'iPhone'
    : ua.includes('ipad')
      ? 'iPad'
      : ua.includes('android')
        ? 'Android'
        : ua.includes('mac os') || ua.includes('macintosh')
          ? 'Mac'
          : ua.includes('windows')
            ? 'Windows'
            : ua.includes('linux')
              ? 'Linux'
              : 'Dispositivo';

  // A ordem importa: Edge e Opera também dizem "chrome" no user agent, e o
  // Safari aparece no do Chrome. Do mais específico para o mais genérico.
  const navegador = ua.includes('edg/')
    ? 'Edge'
    : ua.includes('opr/') || ua.includes('opera')
      ? 'Opera'
      : ua.includes('firefox')
        ? 'Firefox'
        : ua.includes('chrome')
          ? 'Chrome'
          : ua.includes('safari')
            ? 'Safari'
            : null;

  return navegador ? `${sistema} · ${navegador}` : sistema;
}
