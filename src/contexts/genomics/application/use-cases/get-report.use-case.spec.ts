import type { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError } from '@shared/domain/domain-error';

import { GetReportUseCase, type ReportViewer } from './get-report.use-case';

/**
 * O escopo de dono é a contrapartida do seed: `reports.read` diz que o papel
 * pode abrir laudos, o `SubjectLink` diz QUAIS. Sem este check, conceder a
 * permissão ao paciente abriria o laudo de qualquer titular por troca de UUID —
 * e os níveis 2 e 3 devolvem genótipo bruto.
 *
 * A recusa precisa ser indistinguível de laudo inexistente (mesmo erro, mesma
 * mensagem): um 403 confirmaria a um curioso que o id chutado existe.
 */
describe('GetReportUseCase — escopo de dono', () => {
  const REPORT_ID = 'laudo-1';
  const SUBJECT_ID = 'titular-1';

  const patient: ReportViewer = { id: 'user-paciente', roles: ['patient'] };
  const stranger: ReportViewer = { id: 'user-outro', roles: ['patient'] };
  const staff: ReportViewer = { id: 'user-lab', roles: ['lab'] };

  const reportRow = {
    id: REPORT_ID,
    subjectId: SUBJECT_ID,
    panelId: 'painel-1',
    status: 'PUBLISHED',
    publishedAt: new Date('2026-06-21'),
    missingMarkers: null,
    narrative: null,
    panel: { name: 'GeneCode Performance', version: '1.0.0' },
    categoryScores: [],
    modalityIndexes: [],
  };

  function buildPrisma(
    links: ReadonlyArray<{ userId: string; subjectId: string }>,
    status = 'PUBLISHED',
  ) {
    return {
      report: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
          where.id === REPORT_ID ? { ...reportRow, status } : null,
        ),
      },
      subjectLink: {
        findUnique: jest.fn(
          async ({ where }: { where: { userId_subjectId: { userId: string; subjectId: string } } }) =>
            links.find(
              (link) =>
                link.userId === where.userId_subjectId.userId &&
                link.subjectId === where.userId_subjectId.subjectId,
            ) ?? null,
        ),
      },
    };
  }

  const useCase = (prisma: ReturnType<typeof buildPrisma>) =>
    new GetReportUseCase(prisma as unknown as PrismaService);

  it('entrega o laudo ao titular vinculado', async () => {
    const prisma = buildPrisma([{ userId: patient.id, subjectId: SUBJECT_ID }]);

    const result = await useCase(prisma).summary(REPORT_ID, patient);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.id).toBe(REPORT_ID);
  });

  it('nega o laudo de outro titular como NOT_FOUND, não FORBIDDEN', async () => {
    const prisma = buildPrisma([{ userId: patient.id, subjectId: SUBJECT_ID }]);

    const result = await useCase(prisma).summary(REPORT_ID, stranger);

    expect(result.isFail()).toBe(true);
    if (result.isFail()) {
      expect(result.error).toBeInstanceOf(NotFoundError);
      expect(result.error.message).toBe('Laudo não encontrado.');
    }
  });

  it('responde igual para laudo alheio e laudo inexistente', async () => {
    const prisma = buildPrisma([]);
    const casos = useCase(prisma);

    const alheio = await casos.summary(REPORT_ID, stranger);
    const inexistente = await casos.summary('nao-existe', stranger);

    expect(alheio.isFail() && inexistente.isFail()).toBe(true);
    if (alheio.isFail() && inexistente.isFail()) {
      expect(alheio.error.constructor).toBe(inexistente.error.constructor);
      expect(alheio.error.message).toBe(inexistente.error.message);
    }
  });

  it('nega ao titular o laudo não publicado — rascunho não é documento vigente', async () => {
    const prisma = buildPrisma([{ userId: patient.id, subjectId: SUBJECT_ID }], 'DRAFT');

    const result = await useCase(prisma).summary(REPORT_ID, patient);

    expect(result.isFail()).toBe(true);
    if (result.isFail()) {
      expect(result.error).toBeInstanceOf(NotFoundError);
      expect(result.error.message).toBe('Laudo não encontrado.');
    }
  });

  it('staff lê rascunho — precisa ver o laudo antes de publicar', async () => {
    const prisma = buildPrisma([], 'DRAFT');

    const result = await useCase(prisma).summary(REPORT_ID, staff);

    expect(result.isOk()).toBe(true);
  });

  it('mantém a leitura ampla do staff, sem consultar vínculo', async () => {
    const prisma = buildPrisma([]);

    const result = await useCase(prisma).summary(REPORT_ID, staff);

    expect(result.isOk()).toBe(true);
    expect(prisma.subjectLink.findUnique).not.toHaveBeenCalled();
  });

  it('aplica o mesmo escopo ao nível 2, antes de tocar o genótipo', async () => {
    const prisma = buildPrisma([]);

    const result = await useCase(prisma).category(REPORT_ID, 'nutricao', stranger);

    expect(result.isFail()).toBe(true);
    if (result.isFail()) expect(result.error).toBeInstanceOf(NotFoundError);
  });

  it('aplica o mesmo escopo ao nível 3, antes de tocar o genótipo', async () => {
    const prisma = buildPrisma([]);

    const result = await useCase(prisma).marker(REPORT_ID, 'rs762551', stranger);

    expect(result.isFail()).toBe(true);
    if (result.isFail()) expect(result.error).toBeInstanceOf(NotFoundError);
  });
});
