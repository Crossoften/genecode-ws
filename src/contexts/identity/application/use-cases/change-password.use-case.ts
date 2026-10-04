import { Inject, Injectable } from '@nestjs/common';

import { HashService } from '@shared/crypto/hash.service';
import { NotFoundError, ValidationError } from '@shared/domain/domain-error';
import { fail, okVoid, type Result } from '@shared/domain/result';

import {
  REFRESH_TOKEN_REPOSITORY,
  type RefreshTokenRepository,
} from '../../domain/ports/refresh-token.repository';
import { USER_REPOSITORY, type UserRepository } from '../../domain/ports/user.repository';
import { Password } from '../../domain/value-objects/password';

export interface ChangePasswordInput {
  readonly currentPassword: string;
  readonly newPassword: string;
}

/**
 * Troca de senha de quem já está logado.
 *
 * Existia só a redefinição por e-mail (`senha/esqueci` + `senha/redefinir`),
 * que serve a quem PERDEU a senha. Quem está dentro e quer trocar não tinha
 * caminho nenhum: a aba "Segurança" do perfil do titular dizia "Em breve."
 * (GEN-13), e o relatório de 01/10 anotou, com razão, que segurança da conta
 * não é funcionalidade opcional.
 *
 * Três regras, todas herdadas do fluxo de redefinição:
 *
 * - exige a senha atual, para uma sessão sequestrada não trocar a senha sozinha
 * - a nova passa pela mesma política de força do cadastro (`Password`)
 * - **revoga todas as sessões**, inclusive a de quem trocou: se a conta foi
 *   comprometida, trocar a senha precisa expulsar quem estava dentro
 */
@Injectable()
export class ChangePasswordUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly sessions: RefreshTokenRepository,
    private readonly hash: HashService,
  ) {}

  async execute(userId: string, input: ChangePasswordInput): Promise<Result<void>> {
    const user = await this.users.findById(userId);
    if (!user) return fail(new NotFoundError('Conta não encontrada.'));

    const confere = await this.hash.verifyPassword(input.currentPassword, user.passwordHash);
    if (!confere) {
      return fail(
        new ValidationError('A senha atual não confere.', { fields: { currentPassword: 'A senha atual não confere.' } }),
      );
    }

    if (input.currentPassword === input.newPassword) {
      return fail(
        new ValidationError('A nova senha precisa ser diferente da atual.', {
          fields: { newPassword: 'A nova senha precisa ser diferente da atual.' },
        }),
      );
    }

    const nova = Password.create(input.newPassword);
    if (nova.isFail()) {
      return fail(
        new ValidationError(nova.error.message, { fields: { newPassword: nova.error.message } }),
      );
    }

    await this.users.updatePassword(userId, await this.hash.hashPassword(nova.value.value));
    await this.sessions.revokeAllForUser(userId);
    return okVoid();
  }
}
