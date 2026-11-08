import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';

/**
 * DDDs que existem no Brasil (Anatel). Lista fechada: "00", "10" ou "20" têm
 * dois dígitos e passariam numa regex, mas não ligam para ninguém.
 */
const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43,
  44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77,
  79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/**
 * Leva o telefone digitado a só dígitos, DDD + número (GC-N05-05).
 *
 * Na reunião de 05/11 o comprador colou `+55 11 9…` no checkout, a tela
 * deixou passar e o pagamento recusou depois. Quem cola do WhatsApp traz o
 * `+55`; quem disca de fixo põe o `0` da operadora. Os dois saem aqui, para
 * a validação olhar só o que importa e a adquirente receber o formato que
 * aceita.
 */
export function normalizarTelefoneBr(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  let digits = raw.replace(/\D/g, '');
  if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2);
  if (digits.length > 10 && digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

/** O número já normalizado é um celular ou fixo brasileiro plausível? */
export function telefoneBrValido(digits: string): boolean {
  if (!/^\d{10,11}$/.test(digits)) return false;
  if (!DDDS.has(Number(digits.slice(0, 2)))) return false;
  // Celular tem 9 dígitos começando em 9; fixo tem 8 começando de 2 a 5.
  return digits.length === 11 ? digits[2] === '9' : /[2-5]/.test(digits[2]);
}

/** Expressão equivalente a `telefoneBrValido` para o `@Matches`. */
const TELEFONE_BR =
  /^(?:1[1-9]|2[12478]|3[1-578]|4[1-9]|5[1345]|6[1-9]|7[134579]|8[1-9]|9[1-9])(?:9\d{8}|[2-5]\d{7})$/;

/** Normaliza e valida o telefone num DTO: `(11) 98765-4321`, `+55…` e `0 11…` passam. */
export function IsTelefoneBr(message = 'Telefone inválido. Informe DDD + número.') {
  const transform = Transform(({ value }) => normalizarTelefoneBr(value));
  const matches = Matches(TELEFONE_BR, { message });
  return (target: object, property: string | symbol) => {
    transform(target, property as string);
    matches(target, property as string);
  };
}
