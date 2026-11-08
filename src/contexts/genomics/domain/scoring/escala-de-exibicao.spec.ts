import { escalaDa, valorExibido, valorExibidoOuNulo } from './escala-de-exibicao';

/** GC-N05-04: "a pessoa com risco alto aparece como se fosse bom" (Flávio, 05/11). */
describe('escala de exibição', () => {
  it('mostra o risco de lesão como risco: escore alto vira risco baixo', () => {
    expect(escalaDa('risco_lesao')).toBe('RISCO');
    expect(valorExibido('risco_lesao', 84.7)).toBe(15.3);
    expect(valorExibido('risco_lesao', 26.7)).toBe(73.3);
    expect(valorExibidoOuNulo('risco_lesao', null)).toBeNull();
  });

  it('não mexe nas outras categorias', () => {
    expect(escalaDa('forca_potencia')).toBe('ESCORE');
    expect(valorExibido('forca_potencia', 84.7)).toBe(84.7);
    expect(valorExibidoOuNulo('forca_potencia', 50)).toBe(50);
  });
});
