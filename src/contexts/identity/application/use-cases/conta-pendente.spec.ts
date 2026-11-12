import type { ConfigService } from '@nestjs/config';

import type { PrismaService } from '@infra/database/prisma.service';
import type { HashService } from '@shared/crypto/hash.service';

import type { NotificationSender } from '../../domain/ports/notification.port';
import type { UserRepository } from '../../domain/ports/user.repository';
import { SmtpNotificationSender } from '../../infrastructure/smtp-notification.sender';
import type { TokenIssuer } from '../services/token-issuer.service';
import { AuthenticateUseCase } from './authenticate.use-case';
import { EquipeUseCase } from './equipe.use-case';
import type { TwoFactorUseCase } from './two-factor.use-case';

const enviados: { to: string; subject: string; text: string }[] = [];
jest.mock('nodemailer', () => ({
  createTransport: () => ({
    sendMail: async (m: { to: string; subject: string; text: string }) => {
      enviados.push(m);
    },
  }),
}));

/**
 * Conta que nunca foi confirmada — o caso do cliente de 12/11/2026.
 *
 * Três portas que deixavam a pessoa presa: o login sem um código que a tela
 * reconheça, o convite de equipe que não avisava quem já tinha cadastro
 * pendente, e o e-mail de convite sem link para a tela onde o token vale.
 */
describe('Conta pendente', () => {
  describe('login', () => {
    function montar(status: 'PENDING' | 'ACTIVE' | 'BLOCKED', senhaConfere: boolean) {
      const users = {
        findByEmail: jest.fn(async () => ({
          id: 'u1',
          name: 'Flavio',
          email: 'flavio@email.com',
          passwordHash: 'hash',
          status,
          emailVerifiedAt: null,
          roles: [],
          permissions: [],
          twoFactorEnabled: false,
        })),
      } as unknown as UserRepository;
      const hash = { verifyPassword: jest.fn(async () => senhaConfere) } as unknown as HashService;
      const tokens = { issueFor: jest.fn() } as unknown as TokenIssuer;
      const twoFactor = { requiresSecondStep: jest.fn(() => false) } as unknown as TwoFactorUseCase;
      return new AuthenticateUseCase(users, hash, tokens, twoFactor);
    }

    it('senha certa em conta pendente devolve EMAIL_NOT_VERIFIED, para a tela oferecer o código', async () => {
      const resultado = await montar('PENDING', true).execute({
        email: 'flavio@email.com',
        password: 'Genecode2026',
      });

      expect(resultado.isFail()).toBe(true);
      if (resultado.isFail()) expect(resultado.error.code).toBe('EMAIL_NOT_VERIFIED');
    });

    it('senha errada em conta pendente continua genérica — nada de revelar o estado da conta', async () => {
      const resultado = await montar('PENDING', false).execute({
        email: 'flavio@email.com',
        password: 'errada',
      });

      expect(resultado.isFail()).toBe(true);
      if (resultado.isFail()) expect(resultado.error.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('convite de equipe', () => {
    const ATOR = { id: 'master-1', roles: ['master'] };

    function montar(existente: { id: string; name: string; status: string } | null) {
      const prisma = {
        role: { findUnique: jest.fn(async () => ({ id: 'papel-admin', name: 'Administrador' })) },
        user: {
          findFirst: jest.fn(async () => (existente ? { ...existente, roles: [] } : null)),
          create: jest.fn(async () => ({ id: 'novo', email: 'novo@genoa.com', name: 'Nova Pessoa' })),
        },
        userRole: { upsert: jest.fn(async () => ({})) },
        passwordReset: {
          updateMany: jest.fn(async () => ({ count: 0 })),
          create: jest.fn(async () => ({})),
        },
      } as unknown as PrismaService;
      const hash = {
        hashPassword: jest.fn(async () => 'hash'),
        generateToken: jest.fn(() => ({ token: 'tok-123', tokenHash: 'h' })),
      } as unknown as HashService;
      const mensagens: { para: string; msg: Record<string, unknown> }[] = [];
      const notifications = {
        send: jest.fn(async (para: string, msg: Record<string, unknown>) => {
          mensagens.push({ para, msg });
        }),
      } as unknown as NotificationSender;
      return { caso: new EquipeUseCase(notifications, prisma, hash), prisma, mensagens };
    }

    it('conta pendente ganha o papel E o convite — senão o acesso não serve para nada', async () => {
      const { caso, prisma, mensagens } = montar({ id: 'pendente', name: 'Flavio', status: 'PENDING' });

      const resultado = await caso.convidar(
        { name: 'Flavio', email: 'flavio@email.com', papel: 'admin' },
        ATOR,
      );

      expect(resultado.isOk()).toBe(true);
      expect(prisma.userRole.upsert).toHaveBeenCalled();
      expect(mensagens).toEqual([
        {
          para: 'flavio@email.com',
          msg: { kind: 'team-invite', token: 'tok-123', name: 'Flavio', papel: 'Administrador' },
        },
      ]);
    });

    it('conta ativa só ganha o papel: ela já entra com a própria senha', async () => {
      const { caso, mensagens } = montar({ id: 'ativa', name: 'Augusto', status: 'ACTIVE' });

      await caso.convidar({ name: 'Augusto', email: 'augusto@email.com', papel: 'admin' }, ATOR);

      expect(mensagens).toHaveLength(0);
    });

    it('e-mail novo recebe o convite de equipe, não o de compra', async () => {
      const { caso, mensagens } = montar(null);

      await caso.convidar({ name: 'Nova Pessoa', email: 'novo@genoa.com', papel: 'admin' }, ATOR);

      expect(mensagens).toHaveLength(1);
      expect(mensagens[0].msg.kind).toBe('team-invite');
    });
  });

  describe('e-mail de convite', () => {
    const config = {
      get: jest.fn((chave: string) =>
        chave === 'APP_PUBLIC_URL' ? 'https://genecode.com.br/' : chave === 'SMTP_PORT' ? '587' : 'x',
      ),
    } as unknown as ConfigService<never, true>;

    beforeEach(() => enviados.splice(0));

    it('convite de equipe leva o link da tela de convite e não fala em compra', async () => {
      await new SmtpNotificationSender(config).send('flavio@email.com', {
        kind: 'team-invite',
        token: 'abc_DEF-1',
        name: 'Flavio',
        papel: 'Administrador',
      });

      expect(enviados).toHaveLength(1);
      expect(enviados[0].text).toContain('https://genecode.com.br/#/convite?token=abc_DEF-1');
      expect(enviados[0].text).toContain('Administrador');
      expect(enviados[0].text).not.toMatch(/compra/i);
    });

    it('convite de compra também leva o link, em vez do token solto', async () => {
      await new SmtpNotificationSender(config).send('comprador@email.com', {
        kind: 'account-invite',
        token: 'abc_DEF-1',
        name: 'Ana',
      });

      expect(enviados[0].text).toContain('https://genecode.com.br/#/convite?token=abc_DEF-1');
      expect(enviados[0].text).not.toContain('tela de convite');
    });
  });
});
