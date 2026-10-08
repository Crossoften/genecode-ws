import { Inject, Injectable } from '@nestjs/common';

import { fail, ok, type Result } from '@shared/domain/result';
import { ValidationError } from '@shared/domain/domain-error';

import { USER_REPOSITORY, type UserRepository } from '../../domain/ports/user.repository';
import { TokenIssuer, type IssuedTokens } from '../services/token-issuer.service';
import { VerificationChallengeService } from '../services/verification-challenge.service';
import type { AuthenticatedUser } from './authenticate.use-case';

/** Quanto tempo o código vive. Curto: é uma etapa de entrada, não de cadastro. */
const TWO_FACTOR_TTL_MINUTES = 10;

/**
 * Papéis que entram pelo painel do parceiro e, por isso, exigem a segunda
 * etapa.
 *
 * O painel mostra receita, rede e **dados bancários de repasse**. Era
 * exatamente essa tela que, até 07/10, ficava atrás de uma verificação de
 * mentira: a sessão abria antes do código, nada era conferido e nenhum e-mail
 * saía. A conta que não é de parceiro continua entrando direto, a menos que
 * tenha `twoFactorEnabled` ligado.
 */
const ROLES_COM_SEGUNDA_ETAPA: readonly string[] = ['affiliate', 'professional'];

export interface TwoFactorChallenge {
  readonly challengeId: string;
  /** `pa•••••@email.com` — o suficiente para a pessoa saber onde procurar. */
  readonly maskedEmail: string;
  readonly expiresInSeconds: number;
  /** Só com MOSTRAR_CODIGO_VERIFICACAO ligado; nunca em produção. */
  readonly codigoDeTeste?: string;
}

export interface VerifyTwoFactorInput {
  readonly challengeId: string;
  readonly code: string;
  readonly userAgent?: string;
  readonly ipAddress?: string;
}

/**
 * A segunda etapa da entrada: emite o código e o confere.
 *
 * ### Por que a sessão não existe antes daqui
 *
 * Até 07/10 o front chamava `POST /auth/login`, **guardava o par de tokens** e
 * só então mostrava a tela do código — que não validava nada e não disparava
 * requisição nenhuma. Bastava navegar para `/parceiro` sem digitar para entrar
 * no painel, com dados reais. O código agora nasce aqui e **o token só é
 * emitido depois que ele confere**; não há sessão para pular.
 */
@Injectable()
export class TwoFactorUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly tokens: TokenIssuer,
    private readonly desafios: VerificationChallengeService,
  ) {}

  /** Se esta conta precisa da segunda etapa para entrar. */
  requiresSecondStep(user: {
    readonly roles: readonly string[];
    readonly twoFactorEnabled: boolean;
  }): boolean {
    return (
      user.twoFactorEnabled || user.roles.some((role) => ROLES_COM_SEGUNDA_ETAPA.includes(role))
    );
  }

  /**
   * Abre o desafio: grava o código, manda por e-mail e devolve o identificador.
   *
   * Invalida os desafios anteriores da conta. Sem isso, pedir o código de novo
   * deixaria o anterior valendo, e cada reenvio somaria mais um código vivo
   * para adivinhar.
   */
  async startChallenge(user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
  }): Promise<TwoFactorChallenge> {
    return this.desafios.abrir({
      userId: user.id,
      purpose: 'TWO_FACTOR',
      email: user.email,
      name: user.name,
      ttlMinutes: TWO_FACTOR_TTL_MINUTES,
      notificacao: (code) => ({ kind: 'two-factor', code, name: user.name }),
    });
  }

  /**
   * Confere o código e, só então, emite o par de tokens.
   *
   * Cada erro incrementa `attempts`; ao chegar em 5 o código morre e é preciso
   * pedir outro. Seis dígitos são 10⁶ possibilidades, e sem esse teto o limite
   * global de requisições sozinho deixaria um ataque paciente de pé.
   */
  async verify(
    input: VerifyTwoFactorInput,
  ): Promise<Result<{ tokens: IssuedTokens; user: AuthenticatedUser }>> {
    const conferido = await this.desafios.consumir(input.challengeId, 'TWO_FACTOR', input.code);
    if (conferido.isFail()) return fail(conferido.error);

    // Lido agora, não no login: entre as duas etapas a conta pode ter sido
    // desativada ou ter perdido um papel, e é este estado que vale.
    const user = await this.users.findById(conferido.value.userId);
    if (!user || user.status !== 'ACTIVE') return fail(this.genericFailure());

    const tokens = await this.tokens.issueFor(user, {
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    });

    return ok({
      tokens,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        roles: user.roles,
        permissions: user.permissions,
      },
    });
  }

  /** Conta derrubada entre as duas etapas — mesma recusa de código inválido. */
  private genericFailure(): ValidationError {
    return new ValidationError('Código inválido ou expirado. Peça um novo.');
  }
}
