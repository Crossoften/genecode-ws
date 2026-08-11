import { slugFromName } from './product-slug';

describe('slugFromName', () => {
  it('converte o nome em slug com hífens', () => {
    expect(slugFromName('GeneCode Premium')).toBe('genecode-premium');
  });

  it('remove acentos', () => {
    expect(slugFromName('Nutrigenética Essencial')).toBe('nutrigenetica-essencial');
  });

  it('colapsa símbolos e espaços consecutivos em um único hífen', () => {
    expect(slugFromName('Kit  DNA — 2a edição!')).toBe('kit-dna-2a-edicao');
  });

  it('não começa nem termina com hífen', () => {
    expect(slugFromName('  Premium  ')).toBe('premium');
  });

  it('devolve vazio quando o nome não tem caractere aproveitável', () => {
    expect(slugFromName('!!! ???')).toBe('');
  });

  it('respeita o limite de 80 caracteres da coluna', () => {
    expect(slugFromName('a '.repeat(80)).length).toBeLessThanOrEqual(80);
  });
});
