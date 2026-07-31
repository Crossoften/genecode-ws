import { Injectable } from '@nestjs/common';

import type {
  NarrativeInput,
  NarrativeProvider,
  NarrativeResult,
} from '@contexts/genomics/domain/ports/narrative.provider';

/** Versão do texto-base. Muda quando a redação muda, para rastrear laudos antigos. */
const PROMPT_VERSION = 'table-v1';

const BAND_LABEL: Readonly<Record<string, string>> = {
  FAVORAVEL: 'favorável',
  MODERADO: 'moderado',
  ATENCAO: 'de atenção',
  PRIORIDADE: 'prioritário',
};

/**
 * Gerador determinístico, montado a partir das faixas.
 *
 * É o **padrão da plataforma**, não um plano B degradado. A decisão L4 previu a
 * IA como opção configurável justamente porque um texto montado por regra é
 * auditável, reproduzível e não custa nada por laudo — e porque o cliente ainda
 * não ratificou a redação da IA.
 *
 * Também é o destino da IA quando o guardrail recusa a saída. Nesse caso o laudo
 * sai com texto conservador em vez de não sair.
 */
@Injectable()
export class TableNarrativeProvider implements NarrativeProvider {
  generate(input: NarrativeInput): Promise<NarrativeResult> {
    return Promise.resolve({
      text: this.compose(input),
      provider: 'table',
      model: null,
      promptVersion: PROMPT_VERSION,
      fallbackReason: null,
    });
  }

  /** Monta o texto a partir dos extremos do laudo. */
  private compose(input: NarrativeInput): string {
    const ordered = [...input.categories].sort((a, b) => b.score - a.score);
    const strengths = ordered.filter((category) => category.band === 'FAVORAVEL').slice(0, 3);
    const priorities = ordered
      .filter((category) => category.band === 'PRIORIDADE' || category.band === 'ATENCAO')
      .slice(-3)
      .reverse();

    const parts: string[] = [];

    parts.push(
      input.globalIndex === null
        ? `Este é o resumo do seu painel de ${input.panelName}.`
        : `Seu índice global no painel de ${input.panelName} é ${format(input.globalIndex)}, ` +
          `numa escala de 20 a 90 comparada à população de referência.`,
    );

    if (strengths.length > 0) {
      parts.push(
        `Seus pontos mais favoráveis são ${list(strengths.map((c) => `${c.name} (${format(c.score)})`))}. ` +
          `Resultados nesta faixa indicam predisposição genética vantajosa nestes aspectos.`,
      );
    }

    if (priorities.length > 0) {
      parts.push(
        `Merecem mais atenção ${list(priorities.map((c) => `${c.name} (${format(c.score)})`))}. ` +
          `Escores nesta faixa não indicam problema de saúde: apontam onde seus hábitos e seu ` +
          `treino tendem a fazer mais diferença.`,
      );
    }

    const balanced = ordered.filter((category) => category.band === 'MODERADO');
    if (balanced.length > 0 && strengths.length === 0 && priorities.length === 0) {
      parts.push(
        `Seus resultados ficaram concentrados na faixa ${BAND_LABEL.MODERADO}, sem extremos ` +
          `marcantes — um perfil equilibrado entre as categorias avaliadas.`,
      );
    }

    parts.push(
      `Este laudo descreve predisposição genética, que é apenas uma parte do quadro. ` +
        `A leitura junto de um profissional de saúde ou de educação física é o que transforma ` +
        `estes números em decisão prática.`,
    );

    return parts.join(' ');
  }
}

function format(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

function list(items: readonly string[]): string {
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}
