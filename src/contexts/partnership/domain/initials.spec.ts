import { initialsOf } from './initials';

describe('initialsOf', () => {
  it('usa a primeira letra do primeiro e do último nome', () => {
    expect(initialsOf('Marina Costa')).toBe('MC');
    expect(initialsOf('Ana Beatriz de Souza')).toBe('AS');
  });

  it('cai para as duas primeiras letras quando há uma palavra só', () => {
    expect(initialsOf('NutriBem')).toBe('NU');
  });

  it('ignora espaços extras', () => {
    expect(initialsOf('  João   Silva  ')).toBe('JS');
  });

  it('devolve vazio quando o nome é vazio', () => {
    expect(initialsOf('   ')).toBe('');
  });
});
