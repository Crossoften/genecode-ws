import { ChangePasswordUseCase } from './change-password.use-case';

const hashFake = {
  hashPassword: jest.fn(async (p: string) => `hash(${p})`),
  verifyPassword: jest.fn(async (p: string, h: string) => h === `hash(${p})`),
};

function montar(senhaAtual = 'SenhaAtual1') {
  const users = {
    findById: jest.fn(async () => ({
      id: 'u1',
      email: 'titular@genecode.test',
      passwordHash: `hash(${senhaAtual})`,
      name: 'Titular',
      status: 'ACTIVE' as const,
      emailVerifiedAt: new Date(),
      twoFactorEnabled: false,
      deletedAt: null,
      permissions: [],
      roles: ['patient'],
    })),
    updatePassword: jest.fn(async () => undefined),
  };
  const sessions = { revokeAllForUser: jest.fn(async () => undefined) };
  const uc = new ChangePasswordUseCase(
    users as never,
    sessions as never,
    hashFake as never,
  );
  return { uc, users, sessions };
}

describe('Troca de senha da conta logada', () => {
  beforeEach(() => jest.clearAllMocks());

  it('troca a senha e derruba todas as sessões', async () => {
    const { uc, users, sessions } = montar();
    const r = await uc.execute('u1', {
      currentPassword: 'SenhaAtual1',
      newPassword: 'SenhaNova2',
    });

    expect(r.isOk()).toBe(true);
    expect(users.updatePassword).toHaveBeenCalledWith('u1', 'hash(SenhaNova2)');
    // Trocar a senha tem de expulsar quem estava dentro.
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith('u1');
  });

  it('recusa quando a senha atual não confere', async () => {
    const { uc, users, sessions } = montar();
    const r = await uc.execute('u1', {
      currentPassword: 'ChutandoAqui1',
      newPassword: 'SenhaNova2',
    });

    expect(r.isFail()).toBe(true);
    expect(users.updatePassword).not.toHaveBeenCalled();
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('recusa repetir a senha atual', async () => {
    const { uc, users } = montar();
    const r = await uc.execute('u1', {
      currentPassword: 'SenhaAtual1',
      newPassword: 'SenhaAtual1',
    });

    expect(r.isFail()).toBe(true);
    expect(users.updatePassword).not.toHaveBeenCalled();
  });

  it('aplica a política de força à nova senha', async () => {
    const { uc, users } = montar();
    const r = await uc.execute('u1', { currentPassword: 'SenhaAtual1', newPassword: 'curta' });

    expect(r.isFail()).toBe(true);
    if (r.isFail()) expect(r.error.message).toContain('8 caracteres');
    expect(users.updatePassword).not.toHaveBeenCalled();
  });
});
