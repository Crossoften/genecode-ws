import { kitDoCodigo, somenteDigitos } from './compute-report.use-case';

/**
 * O código do kit é o único elo entre o tubo que chega ao laboratório e a
 * pessoa que coletou. Até 04/10 um código que não casava não dava erro: o
 * sistema criava um titular novo e respondia "1 laudo gerado". O laudo ia para
 * um fantasma, a pessoa certa seguia em "Em análise", e nada na tela dizia por
 * quê. Estes testes guardam a regra que substituiu aquilo.
 */
describe('código do kit no CSV do laboratório', () => {
  const kits = [
    { code: '998088-11', subjectId: 'beatriz' },
    { code: '871177-11', subjectId: 'outra-pessoa' },
  ];

  it('acha o kit com ou sem o traço — é o mesmo código', () => {
    expect(kitDoCodigo(kits, '998088-11')?.subjectId).toBe('beatriz');
    expect(kitDoCodigo(kits, '99808811')?.subjectId).toBe('beatriz');
    expect(kitDoCodigo(kits, ' 998088 11 ')?.subjectId).toBe('beatriz');
  });

  it('não acha nada quando o código não existe — e é isso que precisa acontecer', () => {
    // O caso de uso transforma este `undefined` numa linha recusada, com o
    // motivo escrito. Antes, virava titular novo.
    expect(kitDoCodigo(kits, '000000-00')).toBeUndefined();
    expect(kitDoCodigo(kits, '')).toBeUndefined();
    expect(kitDoCodigo(kits, '---')).toBeUndefined();
  });

  it('não aproxima códigos parecidos', () => {
    // Os dois kits acima terminam em 11. Casar por sufixo, ou por prefixo,
    // atribuiria a amostra à pessoa errada.
    expect(kitDoCodigo(kits, '11')).toBeUndefined();
    expect(kitDoCodigo(kits, '998088')).toBeUndefined();
    expect(kitDoCodigo(kits, '998088-111')).toBeUndefined();
  });

  it('reduz o código ao que ele tem de significativo', () => {
    expect(somenteDigitos('998088-11')).toBe('99808811');
    expect(somenteDigitos('kit 998088/11')).toBe('99808811');
    expect(somenteDigitos('sem número')).toBe('');
  });
});
