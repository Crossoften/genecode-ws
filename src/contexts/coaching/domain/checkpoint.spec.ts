import { Checkpoint, assertCheckpointAvailable, resolveNextCheckpoint } from './checkpoint';

const at = (iso: string): Date => new Date(iso);

/**
 * Trava sequencial dos checkpoints.
 *
 * A regra é do laboratório, não conveniência de produto: a entrevista mede
 * mudança de hábito, e três meses é o intervalo em que faz sentido esperar
 * diferença. Responder antes produziria uma curva de evolução sem significado.
 */
describe('Checkpoints da entrevista ambiental', () => {
  it('Q0 está disponível no primeiro atendimento', () => {
    const availability = resolveNextCheckpoint([], at('2026-01-15'));
    expect(availability.next).toBe(Checkpoint.Q0);
    expect(availability.unlocked).toBe(true);
  });

  it('Q1 fica travado até 3 meses após a conclusão de Q0', () => {
    const completed = [{ checkpoint: Checkpoint.Q0, completedAt: at('2026-01-15') }];

    const antes = resolveNextCheckpoint(completed, at('2026-04-14'));
    expect(antes.next).toBe(Checkpoint.Q1);
    expect(antes.unlocked).toBe(false);
    expect(antes.unlocksAt?.toISOString().slice(0, 10)).toBe('2026-04-15');

    const noDia = resolveNextCheckpoint(completed, at('2026-04-15'));
    expect(noDia.unlocked).toBe(true);
  });

  it('conta os 3 meses a partir do checkpoint anterior, não do primeiro', () => {
    const completed = [
      { checkpoint: Checkpoint.Q0, completedAt: at('2026-01-15') },
      // Q1 foi feito com atraso, em junho e não em abril.
      { checkpoint: Checkpoint.Q1, completedAt: at('2026-06-10') },
    ];

    const availability = resolveNextCheckpoint(completed, at('2026-07-01'));
    expect(availability.next).toBe(Checkpoint.Q2);
    expect(availability.unlocked).toBe(false);
    // Setembro, não julho: o atraso empurra a régua inteira.
    expect(availability.unlocksAt?.toISOString().slice(0, 10)).toBe('2026-09-10');
  });

  it('preserva o fim do mês ao somar 3 meses', () => {
    // 30/11 + 3 meses cai em 28/02, não em 02/03 como o setMonth faria.
    const completed = [{ checkpoint: Checkpoint.Q0, completedAt: at('2025-11-30') }];
    const availability = resolveNextCheckpoint(completed, at('2026-01-01'));
    expect(availability.unlocksAt?.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('reconhece o ciclo concluído após os cinco', () => {
    const completed = [
      { checkpoint: Checkpoint.Q0, completedAt: at('2025-01-15') },
      { checkpoint: Checkpoint.Q1, completedAt: at('2025-04-15') },
      { checkpoint: Checkpoint.Q2, completedAt: at('2025-07-15') },
      { checkpoint: Checkpoint.Q3, completedAt: at('2025-10-15') },
      { checkpoint: Checkpoint.Q4, completedAt: at('2026-01-15') },
    ];
    expect(resolveNextCheckpoint(completed, at('2026-06-01')).next).toBeNull();
  });

  describe('bloqueio', () => {
    const q0 = [{ checkpoint: Checkpoint.Q0, completedAt: at('2026-01-15') }];

    it('recusa refazer uma entrevista já concluída', () => {
      // O Dr. Câmara: "aquilo ali tá bloqueado. Não dá para ir em outro:
      // 'ah, faz aí agora que agora eu aprendi a responder melhor'."
      const result = assertCheckpointAvailable(Checkpoint.Q0, q0, at('2026-06-01'));
      expect(result.isFail()).toBe(true);
      if (result.isFail()) expect(result.error.message).toContain('não pode ser refeita');
    });

    it('recusa pular checkpoint', () => {
      const result = assertCheckpointAvailable(Checkpoint.Q3, q0, at('2027-01-01'));
      expect(result.isFail()).toBe(true);
      if (result.isFail()) expect(result.error.message).toContain('próxima entrevista é a Q1');
    });

    it('mostra a data exata de liberação quando ainda está travado', () => {
      const result = assertCheckpointAvailable(Checkpoint.Q1, q0, at('2026-03-01'));
      expect(result.isFail()).toBe(true);
      if (result.isFail()) expect(result.error.message).toMatch(/libera em 15\/04\/2026/);
    });

    it('libera quando a data chega', () => {
      expect(assertCheckpointAvailable(Checkpoint.Q1, q0, at('2026-04-15')).isOk()).toBe(true);
    });
  });
});
