import { validarAgencia, validarChavePix, validarConta } from './chave-pix';

describe('Chave PIX', () => {
  describe('CPF/CNPJ', () => {
    it('aceita CPF válido e guarda só os dígitos', () => {
      const r = validarChavePix('CPF_CNPJ', '529.982.247-25');
      expect(r.valida).toBe(true);
      expect(r.normalizada).toBe('52998224725');
    });

    it('aceita CNPJ válido', () => {
      expect(validarChavePix('CPF_CNPJ', '11.222.333/0001-81').valida).toBe(true);
    });

    it('recusa número com dígito verificador errado', () => {
      expect(validarChavePix('CPF_CNPJ', '529.982.247-26').valida).toBe(false);
    });

    it('recusa a sequência que o QA conseguiu gravar em 01/10', () => {
      expect(validarChavePix('CPF_CNPJ', '123321123321').valida).toBe(false);
    });

    it('recusa mais de 30 dígitos', () => {
      expect(validarChavePix('CPF_CNPJ', '1'.repeat(31)).valida).toBe(false);
    });
  });

  describe('telefone', () => {
    it.each([
      ['(11) 99999-8888', '+5511999998888'],
      ['11999998888', '+5511999998888'],
      ['+55 11 99999-8888', '+5511999998888'],
      ['1133334444', '+551133334444'],
    ])('normaliza %s para E.164', (entrada, esperado) => {
      const r = validarChavePix('PHONE', entrada);
      expect(r.valida).toBe(true);
      expect(r.normalizada).toBe(esperado);
    });

    it('recusa o mesmo valor que passou como CPF/CNPJ', () => {
      // O campo não era revalidado ao trocar o tipo: o valor digitado como
      // CPF continuava lá e era gravado como telefone.
      expect(validarChavePix('PHONE', '123321123321').valida).toBe(false);
    });

    it('recusa número curto demais', () => {
      expect(validarChavePix('PHONE', '1199').valida).toBe(false);
    });
  });

  describe('e-mail', () => {
    it('aceita e normaliza para minúsculas', () => {
      const r = validarChavePix('EMAIL', '  Parceiro@Genecode.com.BR ');
      expect(r.valida).toBe(true);
      expect(r.normalizada).toBe('parceiro@genecode.com.br');
    });

    it('recusa sem domínio', () => {
      expect(validarChavePix('EMAIL', 'parceiro@').valida).toBe(false);
    });

    it('recusa acima de 77 caracteres, que é o teto do BACEN', () => {
      expect(validarChavePix('EMAIL', `${'a'.repeat(70)}@genecode.com.br`).valida).toBe(false);
    });
  });

  describe('chave aleatória', () => {
    it('aceita UUID v4', () => {
      expect(validarChavePix('RANDOM', '3f2504e0-4f89-41d3-9a0c-0305e82c3301').valida).toBe(true);
    });

    it('recusa texto livre', () => {
      expect(validarChavePix('RANDOM', '123321123321').valida).toBe(false);
    });
  });

  it('recusa chave vazia', () => {
    expect(validarChavePix('EMAIL', '   ').valida).toBe(false);
  });

  it('recusa tipo desconhecido', () => {
    expect(validarChavePix('PIXZAO', 'qualquer').valida).toBe(false);
  });
});

describe('Agência e conta', () => {
  it('aceita agência de 1 a 5 dígitos e completa com zeros', () => {
    expect(validarAgencia('1').normalizada).toBe('0001');
    expect(validarAgencia('1234').normalizada).toBe('1234');
  });

  it('recusa agência vazia', () => {
    expect(validarAgencia('').valida).toBe(false);
  });

  it('recusa conta de um dígito — a que o QA gravou era "2"', () => {
    expect(validarConta('2').valida).toBe(false);
  });

  it('formata a conta com o dígito verificador', () => {
    expect(validarConta('123456789').normalizada).toBe('12345678-9');
  });
});
