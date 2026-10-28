import type { PrismaService } from '@infra/database/prisma.service';

import { compositeIndex } from '../../domain/scoring/report-calculator';
import { bandFor } from '../../domain/scoring/score-band';

export interface GlobalScore {
  readonly value: number;
  readonly band: string;
}

/**
 * Escore ajustado global de um titular num painel (GC-AJ-017).
 *
 * Não é gravado: o ajustado por categoria muda a cada entrevista trimestral, e
 * o global é só a composição deles com os pesos e a curva da modalidade Global
 * do painel — a mesma conta do escore genético global (`compositeIndex`).
 * Calcular na leitura garante que ele nunca fique defasado da última
 * entrevista.
 *
 * @param adjusted - `Assessment.adjustedScores` da entrevista mais recente
 *   (slug → ajustado), ou `null` se ainda não houve nenhuma.
 * @returns `null` sem entrevista, sem modalidade Global ou sem categoria
 *   ajustada com peso — nesses casos a tela mostra só o genético.
 */
export async function adjustedGlobalScore(
  prisma: PrismaService,
  panelId: string,
  adjusted: Readonly<Record<string, number>> | null,
): Promise<GlobalScore | null> {
  if (!adjusted || Object.keys(adjusted).length === 0) return null;

  const global = await prisma.modality.findFirst({
    where: { panelId, isGlobal: true },
    select: {
      weights: { select: { weight: true, category: { select: { slug: true } } } },
      percentiles: {
        orderBy: { rawScore: 'asc' },
        select: { rawScore: true, percentile: true },
      },
    },
  });
  if (!global) return null;

  const composite = compositeIndex(
    {
      categoryWeights: new Map(
        global.weights.map((weight) => [weight.category.slug, Number(weight.weight)]),
      ),
      percentileCurve: global.percentiles.map((point) => ({
        rawScore: Number(point.rawScore),
        percentile: Number(point.percentile),
      })),
    },
    new Map(Object.entries(adjusted).filter(([, value]) => typeof value === 'number')),
  );
  if (composite === null) return null;

  return { value: composite.normalizedIndex, band: bandFor(composite.normalizedIndex) };
}
