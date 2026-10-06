import { lerListaOficial } from './lista-oficial';

/**
 * A leitura da lista é o único ponto em que a planilha da Genoa encontra a
 * nossa regra de módulo 11. Divergência aqui vira envelope que não ativa, e só
 * aparece com a caixa na mão de alguém.
 */
describe('lista oficial dos 500 mil códigos', () => {
  const cabecalho = 'sequencial,codigo';

  it('lê sequencial e código na ordem da planilha', () => {
    const lista = lerListaOficial(`${cabecalho}\n1,557459-54\n2,618737-48\n14,734233-00\n`);
    expect(lista).toEqual([
      { sequencial: 1, code: '557459-54', usable: true },
      { sequencial: 2, code: '618737-48', usable: true },
      // O código do envelope que a Genoa fotografou em 06/10.
      { sequencial: 14, code: '734233-00', usable: true },
    ]);
  });

  it('marca como inutilizável a base trivial que o validador recusa', () => {
    // Oito códigos da lista real são assim. Passam no módulo 11, mas a
    // blacklist os recusa na ativação: impressos, dariam caixa que nunca abre.
    const lista = lerListaOficial(`${cabecalho}\n227837,777777-94\n303571,999999-00\n`);
    expect(lista.map((linha) => linha.usable)).toEqual([false, false]);
  });

  it('interrompe a carga quando um código não confere com o módulo 11', () => {
    expect(() => lerListaOficial(`${cabecalho}\n1,557459-54\n2,618737-99\n`)).toThrow(
      /não conferem com o módulo 11/,
    );
  });

  it('recusa código repetido — seriam dois envelopes com o mesmo número', () => {
    expect(() => lerListaOficial(`${cabecalho}\n1,557459-54\n2,557459-54\n`)).toThrow(/repetido/);
  });

  it('recusa linha fora do formato', () => {
    expect(() => lerListaOficial(`${cabecalho}\n1,55745954\n`)).toThrow(/fora do formato/);
    expect(() => lerListaOficial(`${cabecalho}\nx,557459-54\n`)).toThrow(/Sequencial inválido/);
  });

  it('recusa um arquivo que não é a lista', () => {
    expect(() => lerListaOficial('codigo\n557459-54\n')).toThrow(/Cabeçalho inesperado/);
  });
});
