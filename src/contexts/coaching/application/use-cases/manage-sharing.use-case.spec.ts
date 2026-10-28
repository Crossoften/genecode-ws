import type { ConfigService } from '@nestjs/config';

import type { NotificationSender } from '@contexts/identity/domain/ports/notification.port';
import type { PrismaService } from '@infra/database/prisma.service';

import { ManageSharingUseCase } from './manage-sharing.use-case';

const config = {
  get: () => 'https://homolog.crosoften.com/genecode-app/',
} as unknown as ConfigService<never, true>;
const silentSender: NotificationSender = { send: jest.fn(async () => undefined) };

/**
 * The professional's patient list is the one place a professional sees other
 * people's data, so the tests pin its two contracts: names and scores are
 * resolved in batches (one query per source, never per row), and revoked
 * sharings stay visible with their status — the screen shows the "consent
 * revoked" card while the report use case denies the actual access.
 */
describe('ManageSharingUseCase — listForProfessional', () => {
  const PROFESSIONAL_ID = 'prof-1';

  const professional = {
    id: PROFESSIONAL_ID,
    userId: 'user-prof',
    specialty: 'Nutricionista',
    councilId: null,
    bio: null,
  };

  function sharing(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'share-1',
      subjectId: 'subject-a',
      professionalId: PROFESSIONAL_ID,
      professional,
      status: 'AUTHORIZED',
      initiatedBy: 'PATIENT',
      requestedAt: new Date('2026-08-01'),
      authorizedAt: new Date('2026-08-01'),
      revokedAt: null,
      ...overrides,
    };
  }

  interface Fixtures {
    sharings?: unknown[];
    links?: unknown[];
    kits?: unknown[];
    reports?: unknown[];
    assessmentGroups?: unknown[];
    orders?: unknown[];
  }

  function buildPrisma(fixtures: Fixtures) {
    return {
      dataSharing: { findMany: jest.fn(async () => fixtures.sharings ?? []) },
      subjectLink: { findMany: jest.fn(async () => fixtures.links ?? []) },
      kit: { findMany: jest.fn(async () => fixtures.kits ?? []) },
      report: { findMany: jest.fn(async () => fixtures.reports ?? []) },
      assessment: { groupBy: jest.fn(async () => fixtures.assessmentGroups ?? []) },
      order: { findMany: jest.fn(async () => fixtures.orders ?? []) },
    };
  }

  const useCase = (prisma: ReturnType<typeof buildPrisma>) =>
    new ManageSharingUseCase(prisma as unknown as PrismaService, silentSender, config as never);

  it('resolve os nomes dos titulares em lote — 2 sharings, 1 consulta de vínculos', async () => {
    const prisma = buildPrisma({
      sharings: [
        sharing({ id: 'share-1', subjectId: 'subject-a' }),
        sharing({ id: 'share-2', subjectId: 'subject-b' }),
      ],
      links: [
        { subjectId: 'subject-a', relation: 'SELF', user: { name: 'Ana Souza' } },
        { subjectId: 'subject-b', relation: 'GIFTED', user: { name: 'Quem Comprou' } },
        { subjectId: 'subject-b', relation: 'SELF', user: { name: 'Bruno Lima' } },
      ],
    });

    const patients = await useCase(prisma).listForProfessional(PROFESSIONAL_ID);

    expect(prisma.subjectLink.findMany).toHaveBeenCalledTimes(1);
    expect(patients.map((patient) => patient.subjectName)).toEqual(['Ana Souza', 'Bruno Lima']);
  });

  it('lista o sharing revogado com o status, para o card de consentimento revogado', async () => {
    const prisma = buildPrisma({
      sharings: [
        sharing({ id: 'share-1', subjectId: 'subject-a' }),
        sharing({
          id: 'share-2',
          subjectId: 'subject-b',
          status: 'REVOKED',
          revokedAt: new Date('2026-08-10'),
        }),
      ],
      links: [
        { subjectId: 'subject-a', relation: 'SELF', user: { name: 'Ana Souza' } },
        { subjectId: 'subject-b', relation: 'SELF', user: { name: 'Bruno Lima' } },
      ],
    });

    const patients = await useCase(prisma).listForProfessional(PROFESSIONAL_ID);

    const revoked = patients.find((patient) => patient.id === 'share-2');
    expect(revoked).toBeDefined();
    expect(revoked?.status).toBe('REVOKED');
    expect(revoked?.subjectName).toBe('Bruno Lima');
    expect(prisma.dataSharing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['AUTHORIZED', 'REVOKED'] } }),
      }),
    );
  });

  it('devolve globalIndex null para titular sem laudo publicado', async () => {
    const prisma = buildPrisma({
      sharings: [sharing({ id: 'share-1', subjectId: 'subject-a' })],
      links: [{ subjectId: 'subject-a', relation: 'SELF', user: { name: 'Ana Souza' } }],
      reports: [],
    });

    const [patient] = await useCase(prisma).listForProfessional(PROFESSIONAL_ID);

    expect(patient.globalIndex).toBeNull();
    expect(patient.band).toBeNull();
  });

  it('monta o card completo: produto do kit, índice global e entrevistas feitas', async () => {
    const prisma = buildPrisma({
      sharings: [sharing({ id: 'share-1', subjectId: 'subject-a' })],
      links: [{ subjectId: 'subject-a', relation: 'SELF', user: { name: 'Ana Souza' } }],
      kits: [{ subjectId: 'subject-a', orderId: 'order-1' }],
      orders: [{ id: 'order-1', items: [{ productName: 'GeneCode Performance' }] }],
      reports: [
        {
          subjectId: 'subject-a',
          modalityIndexes: [{ normalizedIndex: '72.50', band: 'MODERADO' }],
        },
      ],
      assessmentGroups: [{ subjectId: 'subject-a', _count: { _all: 2 } }],
    });

    const [patient] = await useCase(prisma).listForProfessional(PROFESSIONAL_ID);

    expect(patient.productName).toBe('GeneCode Performance');
    expect(patient.globalIndex).toBe(72.5);
    expect(patient.band).toBe('MODERADO');
    expect(patient.assessmentsCompleted).toBe(2);
  });

  it('sem kit atribuído a pedido, não consulta pedidos e devolve productName null', async () => {
    const prisma = buildPrisma({
      sharings: [sharing({ id: 'share-1', subjectId: 'subject-a' })],
      links: [{ subjectId: 'subject-a', relation: 'SELF', user: { name: 'Ana Souza' } }],
      kits: [{ subjectId: 'subject-a', orderId: null }],
    });

    const [patient] = await useCase(prisma).listForProfessional(PROFESSIONAL_ID);

    expect(patient.productName).toBeNull();
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });
});

/**
 * GC-AJ-027: compartilhar com quem ainda não tem conta vira convite, e o
 * acesso abre sozinho quando o perfil profissional desse e-mail nasce.
 */
describe('ManageSharingUseCase — convite a profissional sem conta', () => {
  function build() {
    const sent: Array<{ to: string; kind: string; link?: string }> = [];
    const sender: NotificationSender = {
      send: jest.fn(async (to, notification) => {
        sent.push({ to, kind: notification.kind, link: (notification as { link?: string }).link });
      }),
    };
    const invites: Array<Record<string, unknown>> = [];
    const prisma = {
      user: {
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
          where.id === 'paciente'
            ? { name: 'Ana Souza', email: 'ana@email.com' }
            : { name: 'Carla Treinadora', email: 'carla@email.com' },
        ),
      },
      professionalProfile: {
        findUnique: jest.fn(async () => ({ id: 'perfil-carla', userId: 'carla' })),
      },
      sharingInvite: {
        upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => {
          const invite = { id: 'convite-1', createdAt: new Date(), acceptedAt: null, ...create };
          invites.push(invite);
          return invite;
        }),
        findMany: jest.fn(async () => invites.filter((invite) => invite.acceptedAt === null)),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) =>
          Object.assign(invites[0]!, data),
        ),
      },
      dataSharing: {
        upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => ({
          id: 'share-novo',
          ...create,
        })),
      },
      auditLog: { create: jest.fn(async () => ({})) },
    };
    const useCase = new ManageSharingUseCase(
      prisma as unknown as PrismaService,
      sender,
      config as never,
    );
    return { prisma, useCase, sent, invites };
  }

  it('e-mail sem conta de profissional vira convite, com link para o cadastro', async () => {
    const { useCase, sent } = build();

    const result = await useCase.grantByPatient('subject-a', ' Carla@Email.com ', 'paciente');

    expect(result.isOk() && result.value.status).toBe('INVITED');
    expect(result.isOk() && result.value.professionalName).toBe('carla@email.com');
    expect(sent).toEqual([
      {
        to: 'carla@email.com',
        kind: 'sharing-invite',
        link: 'https://homolog.crosoften.com/genecode-app/#/profissional/cadastro',
      },
    ]);
  });

  it('o perfil profissional criado com o e-mail convidado abre o acesso autorizado', async () => {
    const { prisma, useCase } = build();
    await useCase.grantByPatient('subject-a', 'carla@email.com', 'paciente');

    const opened = await useCase.acceptInvitesFor('carla');

    expect(opened).toBe(1);
    expect(prisma.dataSharing.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          subjectId: 'subject-a',
          professionalId: 'perfil-carla',
          status: 'AUTHORIZED',
          initiatedBy: 'PATIENT',
        }),
      }),
    );
  });
});
