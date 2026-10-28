import { PrismaClient } from '@prisma/client';

import { MatrixNarrativeProvider } from '../../src/contexts/genomics/infrastructure/narrative/matrix-narrative.provider';
import { TableNarrativeProvider } from '../../src/contexts/genomics/infrastructure/narrative/table-narrative.provider';

/**
 * Regera o resumo de todos os laudos com a matriz do cliente
 * (`npm run seed:narrativas`, GC-AJ-018).
 *
 * O resumo é gravado na emissão e nunca regerado na leitura (decisão L4). Esta
 * é a exceção, pedida pelo cliente em 20/10: os laudos já emitidos passam a ter
 * o texto da matriz, sem IA. O texto anterior não se perde — fica em
 * `narrative.previous`, com o provedor e a versão que o geraram.
 *
 * Rode DEPOIS do `prisma migrate deploy`: a matriz escolhe o texto pela faixa,
 * e as faixas novas só existem depois da migration `20261028120000_tres_faixas`.
 * Rodar duas vezes é inofensivo: laudo que já está na `matriz-v1` é pulado.
 */
const prisma = new PrismaClient();
const provider = new MatrixNarrativeProvider(new TableNarrativeProvider());

async function main(): Promise<void> {
  const reports = await prisma.report.findMany({
    select: {
      id: true,
      narrative: true,
      panel: { select: { name: true } },
      categoryScores: {
        select: {
          normalizedScore: true,
          band: true,
          category: { select: { slug: true, name: true, position: true } },
        },
      },
      modalityIndexes: {
        where: { modality: { isGlobal: true } },
        select: { normalizedIndex: true },
      },
    },
  });

  let regenerated = 0;
  for (const report of reports) {
    const current = (report.narrative ?? null) as Record<string, unknown> | null;
    if (current?.promptVersion === 'matriz-v1') continue;

    const narrative = await provider.generate({
      panelName: report.panel.name,
      categories: [...report.categoryScores]
        .sort((a, b) => a.category.position - b.category.position)
        .map((score) => ({
          slug: score.category.slug,
          name: score.category.name,
          score: Number(score.normalizedScore),
          band: score.band,
        })),
      globalIndex:
        report.modalityIndexes[0] !== undefined
          ? Number(report.modalityIndexes[0].normalizedIndex)
          : null,
    });

    // A tabela devolve o mesmo texto de antes para o painel sem matriz; só
    // grava quando algo mudou, para não reescrever laudo à toa.
    if (current?.text === narrative.text) continue;

    await prisma.report.update({
      where: { id: report.id },
      data: {
        narrative: {
          ...narrative,
          references: (narrative.references ?? []).map((reference) => ({ ...reference })),
          generatedAt: new Date().toISOString(),
          regeneratedFrom: 'GC-AJ-018',
          previous: current
            ? {
                text: typeof current.text === 'string' ? current.text : null,
                provider: typeof current.provider === 'string' ? current.provider : null,
                promptVersion:
                  typeof current.promptVersion === 'string' ? current.promptVersion : null,
              }
            : null,
        },
      },
    });
    regenerated++;
  }

  console.log(`✓ resumo regerado em ${regenerated} de ${reports.length} laudos`);
}

main()
  .catch((erro: unknown) => {
    console.error('Regerar os resumos falhou:', erro);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
