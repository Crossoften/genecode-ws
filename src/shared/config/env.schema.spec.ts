import { codigoDeTesteLiberado } from './env.schema';

/**
 * O código de verificação na resposta é coisa de homolog (card #749, PDF 04 e
 * 08). A chave sozinha não basta: no domínio de produção ele nunca sai.
 */
describe('codigoDeTesteLiberado', () => {
  it('libera no homolog com a chave ligada', () => {
    expect(
      codigoDeTesteLiberado({
        MOSTRAR_CODIGO_VERIFICACAO: 'YES',
        APP_PUBLIC_URL: 'https://homolog.crosoften.com/genecode-app',
      }),
    ).toBe(true);
  });

  it('não libera com a chave desligada', () => {
    expect(
      codigoDeTesteLiberado({
        MOSTRAR_CODIGO_VERIFICACAO: 'NO',
        APP_PUBLIC_URL: 'https://homolog.crosoften.com/genecode-app',
      }),
    ).toBe(false);
  });

  it.each(['https://genecode.com.br', 'https://www.genecode.com.br/', 'https://GENECODE.com.br'])(
    'não libera no domínio de produção (%s), mesmo com a chave ligada',
    (url) => {
      expect(
        codigoDeTesteLiberado({ MOSTRAR_CODIGO_VERIFICACAO: 'YES', APP_PUBLIC_URL: url }),
      ).toBe(false);
    },
  );

  it('não confunde domínio parecido com o de produção', () => {
    expect(
      codigoDeTesteLiberado({
        MOSTRAR_CODIGO_VERIFICACAO: 'YES',
        APP_PUBLIC_URL: 'https://naogenecode.com.br',
      }),
    ).toBe(true);
  });
});
