import { GetReportUseCase, type ReportViewer } from '@contexts/genomics/application/use-cases/get-report.use-case';
import type { PrismaService } from '@infra/database/prisma.service';
import { ForbiddenError, NotFoundError } from '@shared/domain/domain-error';

import { SHARING_ENDED_MESSAGE, SharedReportUseCase } from './shared-report.use-case';

/**
 * Laudo espelho do treinador (GC-N05-15).
 *
 * Os dois contratos que a reunião de 05/11 fixou: com o compartilhamento ATIVO
 * o treinador lê exatamente o que o titular lê — o mesmo DTO, não uma versão
 * resumida —, e sem ele não lê nada. Os testes rodam o `GetReportUseCase` de
 * verdade por baixo, para que "o mesmo conteúdo" seja comparado, não suposto.
 */
describe('SharedReportUseCase — laudo espelho do treinador', () => {
  const SUBJECT_ID = 'titular-1';
  const REPORT_ID = 'laudo-1';
  const PROFILE_ID = 'perfil-treinador';

  const patient: ReportViewer = { id: 'user-paciente', roles: ['patient'] };
  const trainer: ReportViewer = { id: 'user-treinador', roles: ['patient', 'professional'] };

  const reportRow = {
    id: REPORT_ID,
    subjectId: SUBJECT_ID,
    panelId: 'painel-1',
    status: 'PUBLISHED',
    publishedAt: new Date('2026-10-30'),
    missingMarkers: null,
    narrative: { text: 'Perfil de potência.\n\nModulador de recuperação.', provider: 'matriz', references: [] },
    panel: { name: 'GeneCode Performance', version: '1.0.0' },
    categoryScores: [
      {
        normalizedScore: 72,
        band: 'INTERMEDIARIO',
        category: { slug: 'forca-potencia', name: 'Força e Potência', position: 1 },
      },
    ],
    modalityIndexes: [],
  };

  function buildPrisma(sharingStatus: 'AUTHORIZED' | 'REVOKED' | 'PENDING' | null) {
    const sharing = sharingStatus
      ? { id: 'share-1', subjectId: SUBJECT_ID, professionalId: PROFILE_ID, status: sharingStatus }
      : null;

    return {
      professionalProfile: {
        findUnique: jest.fn(async ({ where }: { where: { userId: string } }) =>
          where.userId === trainer.id ? { id: PROFILE_ID } : null,
        ),
      },
      dataSharing: {
        findUnique: jest.fn(async () => sharing),
        // A barreira do GetReportUseCase pergunta pelo vínculo ATIVO do usuário.
        findFirst: jest.fn(
          async ({ where }: { where: { subjectId: string; status: string; professional: { userId: string } } }) =>
            sharing &&
            where.subjectId === sharing.subjectId &&
            where.status === sharing.status &&
            where.professional.userId === trainer.id
              ? { id: sharing.id }
              : null,
        ),
      },
      report: {
        findFirst: jest.fn(async () => ({ id: REPORT_ID })),
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
          where.id === REPORT_ID ? reportRow : null,
        ),
      },
      subjectLink: {
        findUnique: jest.fn(
          async ({ where }: { where: { userId_subjectId: { userId: string; subjectId: string } } }) =>
            where.userId_subjectId.userId === patient.id &&
            where.userId_subjectId.subjectId === SUBJECT_ID
              ? { id: 'link-1' }
              : null,
        ),
      },
      assessment: {
        findFirst: jest.fn(async () => ({ checkpoint: 'Q1', adjustedScores: { 'forca-potencia': 80 } })),
      },
      modality: {
        findFirst: jest.fn(async () => ({
          weights: [{ weight: 1, category: { slug: 'forca-potencia' } }],
          percentiles: [],
        })),
      },
      reportCategoryScore: { findFirst: jest.fn(async () => null) },
      panelSnp: { findFirst: jest.fn(async () => null) },
      subjectGenotype: { findMany: jest.fn(async () => []) },
      interpretation: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
      auditLog: { create: jest.fn(async () => ({})) },
    };
  }

  function build(prisma: ReturnType<typeof buildPrisma>) {
    const reports = new GetReportUseCase(prisma as unknown as PrismaService);
    return { reports, shared: new SharedReportUseCase(prisma as unknown as PrismaService, reports) };
  }

  it('com compartilhamento ativo, devolve ao treinador o MESMO laudo que o titular lê', async () => {
    const prisma = buildPrisma('AUTHORIZED');
    const { reports, shared } = build(prisma);

    const doTitular = await reports.summary(REPORT_ID, patient);
    const doTreinador = await shared.summary(SUBJECT_ID, trainer);

    expect(doTitular.isOk() && doTreinador.isOk()).toBe(true);
    if (doTitular.isOk() && doTreinador.isOk()) {
      expect(doTreinador.value).toEqual(doTitular.value);
      // Não é o resumão: o texto da matriz e o ajustado vêm junto.
      expect(doTreinador.value.narrative?.text).toContain('Perfil de potência.');
      expect(doTreinador.value.categories[0].adjustedScore).toBe(80);
    }
    // A abertura do laudo entra na trilha de auditoria.
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: trainer.id, action: 'sharing.report_viewed' }),
    });
  });

  it.each(['REVOKED', 'PENDING', null] as const)(
    'sem compartilhamento ativo (%s), o treinador não lê nada — 403 com "acesso encerrado"',
    async (status) => {
      const prisma = buildPrisma(status);
      const { shared } = build(prisma);

      const resumo = await shared.summary(SUBJECT_ID, trainer);
      const categoria = await shared.category(SUBJECT_ID, 'forca-potencia', trainer);
      const marcador = await shared.marker(SUBJECT_ID, 'rs1815739', trainer);

      for (const result of [resumo, categoria, marcador]) {
        expect(result.isFail()).toBe(true);
        if (result.isFail()) {
          expect(result.error).toBeInstanceOf(ForbiddenError);
          expect(result.error.message).toBe(SHARING_ENDED_MESSAGE);
        }
      }
      // Nem chega a procurar o laudo, e nada vai para a trilha como leitura.
      expect(prisma.report.findUnique).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    },
  );

  it('conta sem perfil profissional recebe 404', async () => {
    const prisma = buildPrisma('AUTHORIZED');
    const { shared } = build(prisma);

    const result = await shared.summary(SUBJECT_ID, { id: 'user-outro', roles: ['professional'] });

    expect(result.isFail()).toBe(true);
    if (result.isFail()) expect(result.error).toBeInstanceOf(NotFoundError);
  });

  it('titular sem laudo publicado: 404, não um laudo vazio', async () => {
    const prisma = buildPrisma('AUTHORIZED');
    prisma.report.findFirst.mockResolvedValueOnce(null as never);
    const { shared } = build(prisma);

    const result = await shared.summary(SUBJECT_ID, trainer);

    expect(result.isFail()).toBe(true);
    if (result.isFail()) expect(result.error).toBeInstanceOf(NotFoundError);
  });

  // A barreira é do laudo, não só do endpoint: quem tenta pelo id em
  // `/reports/:id` depois de revogado também fica de fora.
  it('revogado, o treinador também não abre o laudo direto pelo id', async () => {
    const prisma = buildPrisma('REVOKED');
    const { reports } = build(prisma);

    const result = await reports.summary(REPORT_ID, trainer);

    expect(result.isFail()).toBe(true);
    if (result.isFail()) expect(result.error).toBeInstanceOf(NotFoundError);
  });

  it('ativo, o treinador abre pelo id também — a regra é uma só', async () => {
    const prisma = buildPrisma('AUTHORIZED');
    const { reports } = build(prisma);

    const result = await reports.summary(REPORT_ID, trainer);

    expect(result.isOk()).toBe(true);
  });
});
