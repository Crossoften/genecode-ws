import { ConflictError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

/**
 * Checkpoints da entrevista ambiental.
 *
 * Cinco pontos ao longo de um ano, espaçados por três meses. A especificação de
 * performance define Q0 como linha de base e Q1–Q4 como as reavaliações
 * trimestrais; o Dr. Câmara descreveu a cadência em 16/07 como *"a cada 3 meses,
 * ao longo de 1 ano"*.
 */
export enum Checkpoint {
  Q0 = 'Q0',
  Q1 = 'Q1',
  Q2 = 'Q2',
  Q3 = 'Q3',
  Q4 = 'Q4',
}

export const CHECKPOINT_SEQUENCE: readonly Checkpoint[] = [
  Checkpoint.Q0,
  Checkpoint.Q1,
  Checkpoint.Q2,
  Checkpoint.Q3,
  Checkpoint.Q4,
];

/** Intervalo mínimo entre checkpoints. */
export const CHECKPOINT_INTERVAL_MONTHS = 3;

export interface CompletedCheckpoint {
  readonly checkpoint: Checkpoint;
  readonly completedAt: Date;
}

export interface CheckpointAvailability {
  readonly next: Checkpoint | null;
  readonly unlocked: boolean;
  /** Data em que libera, quando ainda está travado. */
  readonly unlocksAt: Date | null;
}

/**
 * Decide qual é o próximo checkpoint e se ele já liberou.
 *
 * A trava de tempo é regra do laboratório, não conveniência de produto: a
 * entrevista mede mudança de hábito, e três meses é o intervalo em que faz
 * sentido esperar diferença. Permitir responder antes produziria uma curva de
 * evolução sem significado.
 *
 * Se o profissional tentar antes da data, a especificação manda **bloquear e
 * mostrar a data exata** em que libera — não só recusar.
 *
 * @param completed - Checkpoints já concluídos, em qualquer ordem.
 * @param now - Momento da consulta. Injetado para o teste não depender do relógio.
 */
export function resolveNextCheckpoint(
  completed: readonly CompletedCheckpoint[],
  now: Date,
): CheckpointAvailability {
  const done = new Set(completed.map((entry) => entry.checkpoint));
  const next = CHECKPOINT_SEQUENCE.find((checkpoint) => !done.has(checkpoint)) ?? null;

  // Ciclo completo: os cinco foram respondidos.
  if (next === null) return { next: null, unlocked: false, unlocksAt: null };

  // Q0 é a linha de base e está sempre disponível no primeiro atendimento.
  if (next === Checkpoint.Q0) return { next, unlocked: true, unlocksAt: null };

  const previousIndex = CHECKPOINT_SEQUENCE.indexOf(next) - 1;
  const previous = completed.find(
    (entry) => entry.checkpoint === CHECKPOINT_SEQUENCE[previousIndex],
  );

  // Sem o anterior concluído não há como calcular a liberação. Não deveria
  // acontecer, porque `next` é o primeiro não respondido da sequência.
  if (!previous) return { next, unlocked: false, unlocksAt: null };

  const unlocksAt = addMonths(previous.completedAt, CHECKPOINT_INTERVAL_MONTHS);

  return { next, unlocked: now >= unlocksAt, unlocksAt };
}

/**
 * Verifica se um checkpoint pode ser respondido agora.
 *
 * @returns Sucesso quando liberado, ou um conflito com a data exata de liberação.
 */
export function assertCheckpointAvailable(
  checkpoint: Checkpoint,
  completed: readonly CompletedCheckpoint[],
  now: Date,
): Result<void> {
  if (completed.some((entry) => entry.checkpoint === checkpoint)) {
    return fail(
      new ConflictError(
        `A entrevista ${checkpoint} já foi concluída e não pode ser refeita.`,
        { checkpoint },
      ),
    );
  }

  const availability = resolveNextCheckpoint(completed, now);

  if (availability.next !== checkpoint) {
    return fail(
      new ConflictError(
        availability.next === null
          ? 'O ciclo de entrevistas já foi concluído.'
          : `A próxima entrevista é a ${availability.next}. Os checkpoints são sequenciais.`,
        { expected: availability.next },
      ),
    );
  }

  if (!availability.unlocked) {
    const when = availability.unlocksAt?.toLocaleDateString('pt-BR') ?? '—';
    return fail(
      new ConflictError(`A entrevista ${checkpoint} libera em ${when}.`, {
        checkpoint,
        unlocksAt: availability.unlocksAt?.toISOString(),
      }),
    );
  }

  return ok(undefined);
}

/**
 * Soma meses preservando o fim do mês.
 *
 * 30 de novembro + 3 meses cai em 28 ou 29 de fevereiro, não em 2 de março —
 * que é o que o `setMonth` do JavaScript faria sozinho.
 */
function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const targetDay = result.getDate();
  result.setMonth(result.getMonth() + months);

  if (result.getDate() < targetDay) {
    // Estourou para o mês seguinte: recua para o último dia do mês pretendido.
    result.setDate(0);
  }
  return result;
}
