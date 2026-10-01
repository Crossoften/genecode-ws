import type { ConfigService } from '@nestjs/config';

import type { PrismaService } from '@infra/database/prisma.service';
import type { HashService } from '@shared/crypto/hash.service';

import type { NotificationSender } from '../../domain/ports/notification.port';
import type { UserRepository } from '../../domain/ports/user.repository';
import { RegisterUserUseCase } from './register-user.use-case';

/**
 * O cadastro decide três coisas que não podem escorregar: quem consegue entrar
 * numa conta pendente, o que vaza sobre quem já é cliente, e se quem errou o
 * próprio e-mail tem conserto.
 *
 * O recadastro por CPF é o ponto delicado. Ele só vale para conta **nunca
 * confirmada** — que não prova dono nenhum, não tem laudo, e cujo código de
 * confirmação sempre vai para o e-mail informado agora. Conta confirmada é
 * recusada, e nenhum dos dois caminhos diz o que aconteceu.
 */
describe('RegisterUserUseCase · CPF já cadastrado', () => {
  const ENTRADA = {
    name: 'Ana Beatriz Lemos',
    email: 'ana.nova@email.com',
    password: 'Genecode2026',
    document: '529.982.247-25',
    acceptedConsents: [],
  };

  function montar(dono: { id: string; emailVerifiedAt: Date | null } | null) {
    const atualizacoes: unknown[] = [];
    const codigosCriados: unknown[] = [];
    const invalidacoes: unknown[] = [];

    const prisma = {
      user: {
        findFirst: jest.fn(async () => dono),
        update: jest.fn(async (args: unknown) => {
          atualizacoes.push(args);
          return {};
        }),
      },
      verificationCode: {
        create: jest.fn(async (args: unknown) => {
          codigosCriados.push(args);
          return {};
        }),
        updateMany: jest.fn(async (args: unknown) => {
          invalidacoes.push(args);
          return { count: 1 };
        }),
      },
      role: { findUnique: jest.fn(async () => ({ id: 'papel-paciente' })) },
      userRole: { upsert: jest.fn(async () => ({})) },
      consentDocument: { findFirst: jest.fn(async () => null) },
      consent: { create: jest.fn(async () => ({})) },
    } as unknown as PrismaService;

    const users = {
      findByEmail: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: 'conta-nova' })),
    } as unknown as UserRepository;

    const enviadas: { para: string; code: string }[] = [];
    const notifications = {
      send: jest.fn(async (para: string, msg: { code: string }) => {
        enviadas.push({ para, code: msg.code });
      }),
    } as unknown as NotificationSender;

    const hash = {
      hashPassword: jest.fn(async () => 'hash-da-senha'),
      generateNumericCode: jest.fn(() => ({ code: '424242', codeHash: 'hash-do-codigo' })),
    } as unknown as HashService;

    const config = { get: jest.fn(() => 'NO') } as unknown as ConfigService<never, true>;

    return {
      caso: new RegisterUserUseCase(users, notifications, hash, prisma, config),
      prisma,
      users,
      enviadas,
      atualizacoes,
      codigosCriados,
      invalidacoes,
    };
  }

  it('recadastra a conta pendente e manda o código para o e-mail NOVO', async () => {
    const { caso, users, enviadas, atualizacoes, invalidacoes } = montar({
      id: 'conta-pendente',
      emailVerifiedAt: null,
    });

    const resultado = await caso.execute(ENTRADA);

    expect(resultado.isOk()).toBe(true);
    // Nenhuma conta nova: a pendente é reaproveitada.
    expect(users.create).not.toHaveBeenCalled();

    const dados = (atualizacoes[0] as { where: { id: string }; data: Record<string, unknown> });
    expect(dados.where.id).toBe('conta-pendente');
    expect(dados.data.email).toBe('ana.nova@email.com');
    expect(dados.data.password).toBe('hash-da-senha');
    expect(dados.data.status).toBe('PENDING');

    // O código que foi para a caixa errada deixa de valer.
    expect(invalidacoes).toHaveLength(1);
    expect(enviadas).toEqual([{ para: 'ana.nova@email.com', code: '424242' }]);
  });

  it('procura o CPF só por dígitos, como ele é gravado', async () => {
    const { caso, prisma } = montar({ id: 'conta-pendente', emailVerifiedAt: null });

    await caso.execute(ENTRADA);

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { document: '52998224725', deletedAt: null } }),
    );
  });

  it('recusa quando o CPF é de conta já confirmada, sem dizer que é o CPF', async () => {
    const { caso, users, enviadas } = montar({
      id: 'conta-confirmada',
      emailVerifiedAt: new Date(2026, 8, 1),
    });

    const resultado = await caso.execute(ENTRADA);

    expect(resultado.isFail()).toBe(true);
    if (resultado.isFail()) {
      expect(resultado.error.message).not.toMatch(/cpf|documento/i);
    }
    expect(users.create).not.toHaveBeenCalled();
    expect(enviadas).toHaveLength(0);
  });

  it('CPF livre segue o caminho de sempre', async () => {
    const { caso, users, atualizacoes } = montar(null);

    const resultado = await caso.execute(ENTRADA);

    expect(resultado.isOk()).toBe(true);
    expect(users.create).toHaveBeenCalledTimes(1);
    expect(atualizacoes).toHaveLength(0);
  });

  // Sem CPF não há o que casar, e consultar `document: undefined` traria a
  // primeira conta sem documento do banco — qualquer uma.
  it('cadastro sem CPF não consulta conta nenhuma por documento', async () => {
    const { caso, prisma, users } = montar(null);

    await caso.execute({ ...ENTRADA, document: undefined });

    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(users.create).toHaveBeenCalledTimes(1);
  });
});
