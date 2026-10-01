import { normaliseHeader } from './ingest-genotypes.use-case';

/**
 * O nome da coluna é a única coisa que liga o arquivo do laboratório ao painel.
 * Errar aqui não dá erro de sistema: dá laudo recusado, ou — pior — laudo
 * emitido com um marcador a menos do que ele afirma ter.
 */
describe('normaliseHeader', () => {
  it('aceita as grafias que o laboratório já usa', () => {
    expect(normaliseHeader('ACTN3_rs1815739')).toBe('rs1815739');
    expect(normaliseHeader('rs1815739')).toBe('rs1815739');
    expect(normaliseHeader('  ACTN3_rs1815739  ')).toBe('rs1815739');
    expect(normaliseHeader('ACTN3-rs1815739')).toBe('rs1815739');
    // O mesmo marcador apareceu com dois rótulos de gene em fontes diferentes.
    expect(normaliseHeader('TNF_rs1800629')).toBe('rs1800629');
    expect(normaliseHeader('TNF-alfa_rs1800629')).toBe('rs1800629');
  });

  it('não confunde rsID com naco de palavra', () => {
    // O gene de rs1801278 é o IRS1. Procurando `rs\d+` em qualquer posição, o
    // "RS1" de IRS1 casava primeiro e a coluna virava o marcador `rs1`, que não
    // existe — e o arquivo inteiro era recusado.
    expect(normaliseHeader('IRS1_rs1801278')).toBe('rs1801278');
    expect(normaliseHeader('IRS1-rs1801278')).toBe('rs1801278');
  });

  it('devolve o texto cru quando não há rsID', () => {
    // Nem todo marcador tem rsID: estes dois são comparados como texto.
    expect(normaliseHeader('GSTM1_delecao')).toBe('GSTM1_delecao');
    expect(normaliseHeader('SLC6A4_5HTTLPR')).toBe('SLC6A4_5HTTLPR');
    expect(normaliseHeader('paciente_id')).toBe('paciente_id');
  });

  it('é insensível a maiúsculas', () => {
    expect(normaliseHeader('ACTN3_RS1815739')).toBe('rs1815739');
  });
});
