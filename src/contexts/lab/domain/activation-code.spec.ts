import {
  CodeValidation,
  buildActivationCode,
  checkDigitsFor,
  isTrivialBase,
  validateActivationCode,
} from './activation-code';

/**
 * Validação do código de ativação.
 *
 * O algoritmo foi entregue pelo cliente com implementação de referência em VBA.
 * Os valores esperados abaixo foram calculados manualmente a partir daquela
 * especificação, não a partir desta implementação — senão o teste só confirmaria
 * que o código concorda consigo mesmo.
 */
describe('Código de ativação do kit', () => {
  describe('dígitos verificadores', () => {
    // Calculados à mão: soma com pesos 7→2, módulo 11, resto < 2 vira 0.
    it.each([
      ['123456', '01'],
      ['987654', '50'],
      ['239001', '99'],
      ['111111', '60'],
      ['000000', '00'],
    ])('base %s gera DV %s', (base, expected) => {
      expect(checkDigitsFor(base)).toBe(expected);
    });
  });

  describe('formato', () => {
    it('aceita o código com hífen, como a especificação define', () => {
      const result = validateActivationCode('123456-01');
      expect(result.isOk()).toBe(true);
    });

    it('aceita sem hífen e normaliza', () => {
      // O VBA de referência rejeitava, mas rejeitar quem digita de uma etiqueta
      // de papel é UX ruim sem ganho nenhum. Decisão F3.
      const result = validateActivationCode('12345601');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value).toBe('123456-01');
    });

    it('ignora espaços nas pontas', () => {
      expect(validateActivationCode('  123456-01  ').isOk()).toBe(true);
    });

    it.each(['12345-01', '1234567-01', '', '123456-0'])(
      'recusa comprimento inválido: %s',
      (code) => {
        const result = validateActivationCode(code);
        expect(result.isFail()).toBe(true);
        if (result.isFail()) expect(result.error.message).toBe(CodeValidation.WRONG_FORMAT);
      },
    );

    it('recusa caractere não numérico com a mensagem específica', () => {
      const result = validateActivationCode('12A456-01');
      expect(result.isFail()).toBe(true);
      if (result.isFail()) expect(result.error.message).toBe(CodeValidation.ONLY_NUMBERS);
    });
  });

  describe('dígito verificador errado', () => {
    it('recusa quando o DV não confere', () => {
      const result = validateActivationCode('123456-99');
      expect(result.isFail()).toBe(true);
      if (result.isFail()) expect(result.error.message).toBe(CodeValidation.WRONG_CODE);
    });

    it('pega troca de dois dígitos adjacentes, que é o erro de digitação típico', () => {
      // 123456 é válido com DV 01; 213456 tem outro DV.
      expect(validateActivationCode('213456-01').isFail()).toBe(true);
    });
  });

  describe('sequências triviais', () => {
    it.each(['000000-00', '111111-60'])(
      'recusa %s apesar de o módulo 11 aceitar',
      (code) => {
        const result = validateActivationCode(code);
        expect(result.isFail()).toBe(true);
        if (result.isFail()) expect(result.error.message).toBe(CodeValidation.WRONG_CODE);
      },
    );

    it('expõe a mesma lista para quem gera, senão sai kit impresso que não ativa', () => {
      expect(isTrivialBase('000000')).toBe(true);
      expect(isTrivialBase('999999')).toBe(true);
      expect(isTrivialBase('482913')).toBe(false);
    });
  });

  describe('geração', () => {
    it('gera código que a própria validação aceita', () => {
      for (const base of ['482913', '750264', '319847']) {
        const code = buildActivationCode(base);
        expect(validateActivationCode(code).isOk()).toBe(true);
      }
    });

    it('todo código gerado tem 9 caracteres no formato XXXXXX-XX', () => {
      const code = buildActivationCode('482913');
      expect(code).toMatch(/^\d{6}-\d{2}$/);
      expect(code).toHaveLength(9);
    });
  });

  describe('equivalência com o gerador que existia no checkout', () => {
    /**
     * Cópia literal da fórmula que vivia em `checkout.use-case.ts` até 09/09,
     * escrita no dialeto do CPF (`(soma * 10) % 11`) em vez do `11 - resto`
     * daqui. A duplicata foi removida; este teste é a testemunha dela: os kits
     * criados por aquele código já estão no banco, e se o domínio mudar de
     * regra eles param de validar.
     */
    const dvAntigo = (digitos: string, peso: number): number => {
      const soma = [...digitos].reduce((acc, d, i) => acc + Number(d) * (peso - i), 0);
      const resto = (soma * 10) % 11;
      return resto === 10 ? 0 : resto;
    };

    it(
      'produz o mesmo DV nas 1.000.000 de bases possíveis',
      () => {
        // Sem `expect` dentro do laço de propósito: um milhão de asserções leva
        // minutos. A divergência vira exceção com a base que a causou.
        for (let n = 0; n < 1_000_000; n += 1) {
          const base = String(n).padStart(6, '0');
          const primeiro = dvAntigo(base, 7);
          const antigo = `${primeiro}${dvAntigo(base + primeiro, 8)}`;
          const atual = checkDigitsFor(base);
          if (atual !== antigo) {
            throw new Error(`base ${base}: domínio ${atual} ≠ checkout ${antigo}`);
          }
        }
      },
      60_000,
    );
  });

  describe('as quatro mensagens definidas pelo cliente', () => {
    it('usa o texto literal da especificação', () => {
      // Estes textos são contratuais: vieram do documento "Lógica Validação
      // Código". Mudar qualquer um é decisão de produto, não de código.
      expect(CodeValidation.VALID).toBe('Código Válido.');
      expect(CodeValidation.WRONG_FORMAT).toBe('Formato Incorreto.');
      expect(CodeValidation.ONLY_NUMBERS).toBe('Apenas Números.');
      expect(CodeValidation.WRONG_CODE).toBe('Código Errado, Digite Novamente.');
    });
  });
});
