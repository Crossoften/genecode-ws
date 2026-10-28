/**
 * Porta do gerador de texto de recomendação do laudo.
 *
 * A decisão L4 fixou três coisas sobre esta camada, e a assinatura abaixo existe
 * para tornar as três verificáveis:
 *
 * 1. **Gerado uma vez, na emissão.** Um laudo de saúde precisa ser
 *    reproduzível. Texto gerado a cada abertura faria o mesmo laudo dizer coisas
 *    diferentes em dias diferentes. Por isso a chamada acontece no
 *    `ComputeReportUseCase` e o resultado é persistido com o modelo e a versão
 *    do prompt usados.
 * 2. **Agnóstica de modelo.** A aplicação conhece esta interface, não um
 *    fornecedor. Trocar de modelo — ou voltar para a tabela estática — é mudar
 *    uma variável de ambiente.
 * 3. **Contexto isolado por usuário.** É a preocupação que o cliente levantou:
 *    o risco de a IA responder sobre o laudo de outra pessoa.
 *
 * ### Como o isolamento é garantido
 *
 * Não por disciplina de quem escreve o prompt, e sim pelo tipo: `NarrativeInput`
 * **não tem campo onde caiba outra pessoa**. Não há lista, não há histórico, não
 * há identificador de usuário, não há genótipo. Só os escores derivados de um
 * único laudo, já normalizados. Cada chamada é sem estado e parte do zero.
 *
 * Um efeito colateral bem-vindo: como o genótipo não entra, nenhum dado genético
 * bruto sai da infraestrutura da plataforma em direção a um provedor externo.
 */

/** Categoria como ela é apresentada ao gerador — sem marcador, sem genótipo. */
export interface NarrativeCategory {
  /**
   * Chave estável da categoria (`forca_potencia`…). A matriz do cliente
   * (GC-AJ-018) escolhe o texto pela categoria, e o nome de exibição pode mudar.
   */
  readonly slug: string;
  readonly name: string;
  /** Escore normalizado na escala 20–90. */
  readonly score: number;
  /** Faixa qualitativa já resolvida pelo domínio. */
  readonly band: string;
}

/**
 * Tudo o que o gerador recebe. Deliberadamente pobre.
 *
 * Se um dia alguém precisar passar mais contexto, a mudança tem de ser aqui e
 * ficará visível na revisão — que é exatamente o ponto de o isolamento morar no
 * tipo, e não numa convenção.
 */
export interface NarrativeInput {
  readonly panelName: string;
  readonly categories: readonly NarrativeCategory[];
  /** Índice global do painel, quando existe. */
  readonly globalIndex: number | null;
}

/** Texto aprovado, com a procedência necessária para auditoria. */
export interface NarrativeResult {
  readonly text: string;
  /** Identificador do provedor que gerou: `matrix` ou `table`. */
  readonly provider: string;
  /** Modelo usado, quando houve um. */
  readonly model: string | null;
  /** Versão do prompt, para reproduzir o texto no futuro. */
  readonly promptVersion: string;
  /**
   * Preenchido quando o provedor preferido não pôde montar o texto e outro
   * assumiu — por exemplo, a matriz sem as categorias de Força e Resistência,
   * que cai na tabela.
   */
  readonly fallbackReason: string | null;
  /**
   * Referências científicas citadas no texto, pelo número da matriz do
   * cliente. Vazio quando o provedor não cita nenhuma.
   */
  readonly references?: readonly NarrativeReference[];
}

/** Uma referência citada: o número da matriz e a citação completa. */
export interface NarrativeReference {
  readonly number: number;
  readonly citation: string;
}

export const NARRATIVE_PROVIDER = Symbol('NarrativeProvider');

export interface NarrativeProvider {
  /**
   * Gera o texto de recomendação de um laudo.
   *
   * Nunca lança por falha do provedor: uma indisponibilidade de rede não pode
   * impedir a emissão de um laudo já calculado. O contrato é sempre devolver
   * algo publicável.
   */
  generate(input: NarrativeInput): Promise<NarrativeResult>;
}
