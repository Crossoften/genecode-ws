import { cnpj, cpf } from 'cpf-cnpj-validator';

/**
 * Validação da chave PIX por tipo.
 *
 * Isto é dado de repasse financeiro: uma chave inválida significa bonificação
 * enviada para destino errado ou travada no gateway. Até 03/10 o campo não
 * tinha crítica nenhuma — o QA gravou "123321123321" como telefone, com banco
 * "itaú", agência "1" e conta "2", e recebeu "Dados salvos." (GEN-08).
 *
 * A normalização é parte da regra, não enfeite: a pessoa digita o CPF com
 * pontos, o telefone com parênteses e o e-mail com maiúsculas. Guardar o que
 * foi digitado faria duas chaves iguais parecerem diferentes na hora do
 * repasse.
 */
export type TipoChavePix = 'CPF_CNPJ' | 'EMAIL' | 'PHONE' | 'RANDOM';

export const TIPOS_CHAVE_PIX: readonly TipoChavePix[] = [
  'CPF_CNPJ',
  'EMAIL',
  'PHONE',
  'RANDOM',
];

/** E-mail de PIX: o Banco Central limita a 77 caracteres. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** Chave aleatória: UUID v4 em 36 caracteres, como o BACEN emite. */
const ALEATORIA = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Telefone BR em E.164: +55 + DDD (2) + 8 ou 9 dígitos. */
const TELEFONE = /^\+55\d{2}9?\d{8}$/;

export interface ResultadoChavePix {
  readonly valida: boolean;
  /** Chave no formato de guarda — só quando válida. */
  readonly normalizada: string | null;
  readonly erro: string | null;
}

/**
 * Normaliza e valida a chave para o tipo informado.
 *
 * @param tipo - Tipo declarado da chave.
 * @param chave - Valor digitado, do jeito que veio.
 */
export function validarChavePix(tipo: string, chave: string): ResultadoChavePix {
  const bruta = (chave ?? '').trim();
  if (bruta.length === 0) {
    return { valida: false, normalizada: null, erro: 'Informe a chave PIX.' };
  }

  switch (tipo) {
    case 'CPF_CNPJ': {
      const digitos = bruta.replace(/\D/g, '');
      if (cpf.isValid(digitos) || cnpj.isValid(digitos)) {
        return { valida: true, normalizada: digitos, erro: null };
      }
      return {
        valida: false,
        normalizada: null,
        erro: 'CPF ou CNPJ inválido. Confira os dígitos verificadores.',
      };
    }

    case 'EMAIL': {
      const email = bruta.toLowerCase();
      if (email.length <= 77 && EMAIL.test(email)) {
        return { valida: true, normalizada: email, erro: null };
      }
      return { valida: false, normalizada: null, erro: 'E-mail inválido.' };
    }

    case 'PHONE': {
      // Aceita o que a pessoa digita — (11) 99999-8888, 11999998888,
      // +55 11 99999-8888 — e guarda sempre em E.164.
      const digitos = bruta.replace(/\D/g, '');
      const comPais = digitos.startsWith('55') ? digitos : `55${digitos}`;
      const e164 = `+${comPais}`;
      if (TELEFONE.test(e164)) {
        return { valida: true, normalizada: e164, erro: null };
      }
      return {
        valida: false,
        normalizada: null,
        erro: 'Telefone inválido. Use DDD + número, por exemplo (11) 99999-8888.',
      };
    }

    case 'RANDOM': {
      const uuid = bruta.toLowerCase();
      if (ALEATORIA.test(uuid)) {
        return { valida: true, normalizada: uuid, erro: null };
      }
      return {
        valida: false,
        normalizada: null,
        erro: 'Chave aleatória inválida. São 36 caracteres no formato do Banco Central.',
      };
    }

    default:
      return { valida: false, normalizada: null, erro: 'Tipo de chave PIX desconhecido.' };
  }
}

/** Agência: 1 a 5 dígitos, sem o verificador (que nem todo banco usa). */
export function validarAgencia(valor: string): ResultadoChavePix {
  const digitos = (valor ?? '').replace(/\D/g, '');
  if (digitos.length >= 1 && digitos.length <= 5) {
    return { valida: true, normalizada: digitos.padStart(4, '0'), erro: null };
  }
  return { valida: false, normalizada: null, erro: 'Agência inválida. Informe de 1 a 5 dígitos.' };
}

/** Conta: 2 a 13 dígitos com verificador, guardada como 99999999-9. */
export function validarConta(valor: string): ResultadoChavePix {
  const digitos = (valor ?? '').replace(/\D/g, '');
  if (digitos.length < 2 || digitos.length > 13) {
    return {
      valida: false,
      normalizada: null,
      erro: 'Conta inválida. Informe o número com o dígito verificador.',
    };
  }
  return {
    valida: true,
    normalizada: `${digitos.slice(0, -1)}-${digitos.slice(-1)}`,
    erro: null,
  };
}
