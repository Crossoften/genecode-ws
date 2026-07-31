import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  inspectNarrative,
  type GuardrailVerdict,
} from '@contexts/genomics/domain/narrative/clinical-guardrail';
import type {
  NarrativeInput,
  NarrativeProvider,
  NarrativeResult,
} from '@contexts/genomics/domain/ports/narrative.provider';

import { TableNarrativeProvider } from './table-narrative.provider';

/**
 * Versão do prompt. **Precisa mudar sempre que o texto abaixo mudar.**
 *
 * É o que permite, daqui a um ano, olhar um laudo emitido e saber sob quais
 * instruções aquele texto nasceu. Sem isso, "reproduzível" seria só uma palavra
 * no documento de decisões.
 */
const PROMPT_VERSION = 'ai-v1';

/** Tempo máximo de espera. Emissão de laudo não fica pendurada em rede. */
const TIMEOUT_MS = 20_000;

/**
 * Instruções do sistema — o "até aqui" do Dr. Câmara, escrito.
 *
 * Escrito no imperativo negativo de propósito. Modelos de linguagem cumprem
 * proibições explícitas com muito mais consistência do que inferem limites a
 * partir de um papel ("você é um assistente responsável").
 */
const SYSTEM_PROMPT = [
  'Você redige o parágrafo de recomendação de um laudo de predisposição genética,',
  'em português do Brasil, dirigido ao próprio titular do exame.',
  '',
  'LIMITES ABSOLUTOS — nunca:',
  '- diagnosticar, sugerir diagnóstico ou afirmar que a pessoa tem qualquer doença;',
  '- prescrever medicamento, suplemento, dose, posologia ou tratamento;',
  '- prever que a pessoa desenvolverá alguma condição;',
  '- citar percentuais de risco de doença;',
  '- sugerir que este laudo substitui consulta ou acompanhamento profissional.',
  '',
  'REGRAS DE CONTEÚDO:',
  '- fale apenas das categorias e dos números fornecidos; não invente nenhum outro;',
  '- a escala vai de 20 a 90 e compara o titular com uma população de referência;',
  '- escore baixo significa "onde hábito e treino rendem mais", nunca "problema de saúde";',
  '- entre 3 e 5 frases, tom direto e adulto, sem jargão e sem entusiasmo publicitário;',
  '- encerre lembrando que a leitura com um profissional é o que gera decisão prática.',
].join('\n');

/**
 * Gerador por IA, agnóstico de modelo.
 *
 * O cliente foi específico sobre a forma: **por API, nunca chat**. A diferença
 * não é cosmética — chat implica sessão, e sessão implica contexto acumulado, que
 * é justamente o vetor pelo qual o laudo de uma pessoa vazaria para a conversa
 * de outra. Aqui cada laudo é uma requisição isolada, sem histórico, montada a
 * partir de um `NarrativeInput` que não tem onde guardar outra pessoa.
 *
 * ### O que acontece quando o modelo desobedece
 *
 * O texto é inspecionado antes de ser gravado. Se cruzar o limite clínico, é
 * **descartado inteiro** e a tabela assume, com o motivo registrado no laudo.
 * Nunca se tenta consertar a saída: remover a frase proibida deixaria o resto do
 * parágrafo argumentando em direção a ela.
 *
 * ### Por que a falha nunca sobe
 *
 * O laudo já foi calculado quando esta chamada acontece. Deixar a emissão falhar
 * porque um provedor externo caiu seria trocar um texto por um laudo inteiro.
 */
@Injectable()
export class AiNarrativeProvider implements NarrativeProvider {
  private readonly logger = new Logger(AiNarrativeProvider.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(TableNarrativeProvider) private readonly fallback: TableNarrativeProvider,
  ) {}

  async generate(input: NarrativeInput): Promise<NarrativeResult> {
    const model = this.config.get<string>('AI_NARRATIVE_MODEL')!;

    try {
      const text = await this.call(model, input);
      const verdict = inspectNarrative(text);

      if (!verdict.approved) {
        // Registrar é obrigatório: uma taxa de recusa que sobe é sinal de que o
        // modelo ou o prompt mudou de comportamento, e alguém precisa ver isso.
        this.logger.warn(`Texto recusado pelo guardrail: ${verdict.violations.join(', ')}`);
        return this.degrade(input, `guardrail: ${verdict.violations.join(', ')}`);
      }

      return {
        text: text.trim(),
        provider: 'ai',
        model,
        promptVersion: PROMPT_VERSION,
        fallbackReason: null,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'falha desconhecida';
      this.logger.error(`Geração por IA falhou, usando tabela: ${reason}`);
      return this.degrade(input, `provedor: ${reason}`);
    }
  }

  /** Cai para o texto de tabela, preservando o motivo no registro do laudo. */
  private async degrade(input: NarrativeInput, reason: string): Promise<NarrativeResult> {
    const base = await this.fallback.generate(input);
    return { ...base, fallbackReason: reason };
  }

  /**
   * Requisição ao provedor.
   *
   * Fala o formato de mensagens da API da Anthropic, que é também o que os
   * gateways compatíveis expõem — trocar de fornecedor é trocar `AI_NARRATIVE_URL`
   * e a chave. Se um dia for preciso um formato genuinamente diferente, esta é a
   * única função a reescrever, porque o resto da aplicação só conhece a porta.
   */
  private async call(model: string, input: NarrativeInput): Promise<string> {
    const url = this.config.get<string>('AI_NARRATIVE_URL')!;
    const apiKey = this.config.get<string>('AI_NARRATIVE_API_KEY');

    if (!apiKey) throw new Error('AI_NARRATIVE_API_KEY ausente');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 700,
          // Baixa, mas não zero: um laudo de saúde não precisa de variação
          // criativa, e reprodutibilidade vale mais aqui do que fluência.
          temperature: 0.2,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: renderUserPrompt(input) }],
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = (await response.json()) as {
        content?: { type: string; text?: string }[];
      };

      const text = payload.content
        ?.filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('')
        .trim();

      if (!text) throw new Error('resposta sem texto');
      return text;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Monta o conteúdo da mensagem a partir do input.
 *
 * Só números e nomes de categoria entram. Nenhum identificador, nenhum genótipo,
 * nenhum dado do titular — o `NarrativeInput` não os carrega, então não há como
 * eles chegarem aqui nem por descuido.
 */
function renderUserPrompt(input: NarrativeInput): string {
  const lines = input.categories.map(
    (category) => `- ${category.name}: ${category.score.toFixed(1)} (faixa ${category.band})`,
  );

  return [
    `Painel: ${input.panelName}`,
    input.globalIndex === null ? '' : `Índice global: ${input.globalIndex.toFixed(1)}`,
    'Categorias:',
    ...lines,
  ]
    .filter(Boolean)
    .join('\n');
}

export type { GuardrailVerdict };
