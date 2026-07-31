/**
 * Limite clínico do texto gerado por IA.
 *
 * O Dr. Câmara descreveu a restrição em uma frase, em 16/07: *"eu vou até esse
 * ponto, mas não passo daqui"*. Este módulo é essa frase virada código.
 *
 * A ideia central: **o prompt pede, o guardrail verifica**. Instrução em prompt
 * é probabilística — o modelo cumpre quase sempre, e "quase sempre" não serve
 * para um documento de saúde emitido em nome de um laboratório de 36 anos. Então
 * a saída é conferida antes de ser gravada, e um texto que atravessa o limite é
 * descartado inteiro, não editado. Editar deixaria o resto do parágrafo
 * argumentando em direção à frase removida.
 */

/**
 * Termos que caracterizam ato clínico e que o laudo genético não pratica.
 *
 * A lista não tenta cobrir o português inteiro — cobre as formas em que um
 * modelo de linguagem escorrega para o registro médico quando lhe pedem
 * "recomendação". Ela é uma segunda barreira, não a primeira.
 */
const FORBIDDEN_PATTERNS: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  { pattern: /\bdiagn[óo]stic/i, reason: 'diagnóstico' },
  { pattern: /\b(prescre|prescri)/i, reason: 'prescrição' },
  { pattern: /\b(mg|mcg|UI)\b\s*(por dia|\/dia|ao dia|diári)/i, reason: 'posologia' },
  { pattern: /\b\d+\s*(mg|mcg|g|UI)\b/i, reason: 'dosagem' },
  { pattern: /\bsuplement\w*\s+\d/i, reason: 'dosagem de suplemento' },
  { pattern: /\b(medicament|rem[ée]dio|f[áa]rmac)/i, reason: 'medicamento' },
  { pattern: /\bvoc[êe] (tem|possui|sofre de|apresenta)\s+(uma\s+)?(doen[çc]a|s[íi]ndrome|transtorno)/i, reason: 'afirmação de doença' },
  { pattern: /\b(ir[áa]|vai)\s+desenvolver\b/i, reason: 'predição de doença' },
  { pattern: /\b(risco|chance)\s+de\s+\d+\s*%/i, reason: 'risco numérico de doença' },
  { pattern: /\b(cura|curar|tratamento para|tratar\s+a\s+doen[çc]a)/i, reason: 'tratamento' },
  { pattern: /\bsubstitu\w*\s+(a\s+)?(consulta|avalia[çc][ãa]o m[ée]dica|acompanhamento m[ée]dico)/i, reason: 'substituição de consulta' },
];

/** Tamanho máximo aceito, em caracteres. Acima disso o texto deixou de ser resumo. */
const MAX_LENGTH = 2_400;
/** Abaixo disto o modelo respondeu com evasiva ou erro. */
const MIN_LENGTH = 120;

export interface GuardrailVerdict {
  readonly approved: boolean;
  /** Motivos da recusa, na ordem em que foram detectados. */
  readonly violations: readonly string[];
}

/**
 * Verifica se um texto gerado pode ser mostrado a um paciente.
 *
 * @param text - Texto bruto devolvido pelo provedor.
 * @returns Veredito com os motivos, para registro em auditoria.
 */
export function inspectNarrative(text: string): GuardrailVerdict {
  const violations: string[] = [];

  const trimmed = text.trim();

  if (trimmed.length < MIN_LENGTH) violations.push('texto curto demais');
  if (trimmed.length > MAX_LENGTH) violations.push('texto longo demais');

  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    if (pattern.test(trimmed)) violations.push(reason);
  }

  return { approved: violations.length === 0, violations };
}

/**
 * Confere se o texto só fala de categorias que o laudo realmente calculou.
 *
 * Esta é a checagem contra a alucinação que mais preocupa aqui: o modelo citar
 * uma categoria que o painel do paciente não tem — ou, pior, um número que
 * ninguém calculou. O texto pode omitir categorias; não pode inventar.
 *
 * @param text - Texto gerado.
 * @param allowedNames - Nomes das categorias presentes neste laudo.
 * @param knownCategoryNames - Todos os nomes de categoria existentes na plataforma.
 */
export function inspectCategoryScope(
  text: string,
  allowedNames: readonly string[],
  knownCategoryNames: readonly string[],
): GuardrailVerdict {
  const allowed = new Set(allowedNames.map(normalize));
  const foreign = knownCategoryNames.filter(
    (name) => !allowed.has(normalize(name)) && containsWord(text, name),
  );

  return {
    approved: foreign.length === 0,
    violations: foreign.map((name) => `categoria fora do laudo: ${name}`),
  };
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function containsWord(haystack: string, needle: string): boolean {
  return normalize(haystack).includes(normalize(needle));
}
