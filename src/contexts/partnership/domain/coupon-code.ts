import { randomInt } from 'node:crypto';

/**
 * Geração do cupom exclusivo do parceiro.
 *
 * O cupom é o vínculo entre a venda e a comissão, então precisa ser: legível o
 * bastante para caber num story de Instagram, único, e não adivinhável a ponto
 * de alguém colar o cupom de outro parceiro por acaso.
 *
 * A estratégia é derivar do nome — que é o que o parceiro espera ver — e sufixar
 * com dígitos aleatórios para garantir unicidade sem virar hash ilegível.
 */

/** Caracteres ambíguos removidos: O/0 e I/1 confundem quem digita de um vídeo. */
const SAFE_DIGITS = '23456789';

/**
 * Sugere um código a partir do nome do parceiro.
 *
 * @param displayName - Nome como o parceiro quer aparecer.
 * @param taken - Códigos já em uso, para evitar colisão.
 */
export function suggestCouponCode(displayName: string, taken: ReadonlySet<string>): string {
  const base = displayName
    .normalize('NFD')
    // Remove acentos: o cupom é digitado em teclados variados.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase()
    .slice(0, 10);

  const prefix = base.length >= 3 ? base : 'PARCEIRO';

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const suffix = Array.from({ length: 3 }, () => SAFE_DIGITS[randomInt(SAFE_DIGITS.length)]).join(
      '',
    );
    const candidate = `${prefix}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }

  // Improvável: 8³ = 512 combinações por prefixo. Se acontecer, alonga o sufixo.
  const fallback = Array.from({ length: 6 }, () => SAFE_DIGITS[randomInt(SAFE_DIGITS.length)]).join(
    '',
  );
  return `${prefix}${fallback}`;
}
