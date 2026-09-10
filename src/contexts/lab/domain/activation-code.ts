import { ValidationError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

/**
 * Código de ativação do kit.
 *
 * Especificação entregue pelo cliente em dois documentos — "Ativação do código
 * da amostra" e "Lógica Validação Código (TEXTO)" —, este último com a
 * implementação de referência em VBA. Formato `XXXXXX-XX`: 6 dígitos de base,
 * hífen obrigatório, 2 dígitos verificadores por módulo 11.
 *
 * O propósito declarado pelo cliente: *"Se o comprador ler o código
 * incorretamente, ele não funcionará."* Ou seja, o DV existe para pegar erro de
 * transcrição humana — alguém lendo de uma etiqueta de papel —, não para
 * segurança. **Validar o DV não substitui checar o código no banco**: existe? já
 * foi ativado? pertence a que pedido?
 *
 * Os pesos são 7→2 e 8→2, diferentes dos do CPF (10→2 e 11→2), porque a base
 * aqui tem 6 dígitos e não 9.
 */

/** Resultado da validação, com os textos exatos definidos pelo cliente. */
export enum CodeValidation {
  VALID = 'Código Válido.',
  WRONG_FORMAT = 'Formato Incorreto.',
  ONLY_NUMBERS = 'Apenas Números.',
  WRONG_CODE = 'Código Errado, Digite Novamente.',
}

/**
 * Sequências triviais recusadas.
 *
 * O algoritmo mod 11 aceita `000000-00` e `111111-60` — são matematicamente
 * válidos. O CPF tem blacklist equivalente pelo mesmo motivo: um código trivial
 * passa por acidente e confunde o suporte.
 *
 * Não estava na especificação do cliente; é acréscimo, e está registrado como
 * tal nas decisões (F3).
 */
const TRIVIAL_BASES = new Set([
  '000000', '111111', '222222', '333333', '444444',
  '555555', '666666', '777777', '888888', '999999',
]);

/**
 * Valida um código de ativação.
 *
 * Aceita com ou sem hífen. O VBA de referência rejeitava sem hífen, mas rejeitar
 * quem digita de uma etiqueta de papel é UX ruim para nenhum ganho — a
 * normalização está registrada na decisão F3.
 *
 * @param raw - Código como digitado.
 * @returns O código normalizado, ou a mensagem exata que o cliente especificou.
 */
export function validateActivationCode(raw: string): Result<string> {
  const trimmed = raw.trim();
  const digitsOnly = trimmed.replace(/-/g, '');

  if (digitsOnly.length !== 8) {
    return fail(new ValidationError(CodeValidation.WRONG_FORMAT, { code: raw }));
  }

  if (!/^\d{8}$/.test(digitsOnly)) {
    return fail(new ValidationError(CodeValidation.ONLY_NUMBERS, { code: raw }));
  }

  const base = digitsOnly.slice(0, 6);
  const providedCheck = digitsOnly.slice(6);

  if (isTrivialBase(base)) {
    return fail(new ValidationError(CodeValidation.WRONG_CODE, { code: raw }));
  }

  if (checkDigitsFor(base) !== providedCheck) {
    return fail(new ValidationError(CodeValidation.WRONG_CODE, { code: raw }));
  }

  return ok(`${base}-${providedCheck}`);
}

/**
 * A base é uma das sequências triviais recusadas na validação?
 *
 * Exposta para quem **gera** código, não só para quem valida: um kit impresso
 * sobre base trivial nunca ativaria, e a caixa já teria saído para o cliente.
 *
 * @param base - Exatamente 6 dígitos.
 */
export function isTrivialBase(base: string): boolean {
  return TRIVIAL_BASES.has(base);
}

/**
 * Calcula os dois dígitos verificadores de uma base de 6 dígitos.
 *
 * Também usado para **gerar** códigos: o laboratório precisa da função direta
 * para imprimir os kits, não só da validação.
 *
 * @param base - Exatamente 6 dígitos.
 */
export function checkDigitsFor(base: string): string {
  const digits = [...base].map(Number);

  // Primeiro DV: pesos 7, 6, 5, 4, 3, 2.
  const sum1 = digits.reduce((total, digit, index) => total + digit * (7 - index), 0);
  const first = modulo11(sum1);

  // Segundo DV: pesos 8, 7, 6, 5, 4, 3 sobre a base, mais 2 sobre o primeiro DV.
  const sum2 = digits.reduce((total, digit, index) => total + digit * (8 - index), 0) + first * 2;
  const second = modulo11(sum2);

  return `${first}${second}`;
}

/**
 * Gera um código de ativação completo a partir de uma base.
 *
 * @param base - 6 dígitos. Quem chama garante unicidade.
 */
export function buildActivationCode(base: string): string {
  return `${base}-${checkDigitsFor(base)}`;
}

/**
 * Regra do módulo 11: resto menor que 2 vira dígito 0.
 *
 * Cobre os casos em que `11 - resto` daria 10 ou 11, que ocupariam dois
 * caracteres. Mesma convenção do CPF.
 */
function modulo11(sum: number): number {
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}
