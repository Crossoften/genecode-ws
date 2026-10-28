import { SandboxShippingProvider, simplePdf } from './sandbox-shipping.provider';

/** GC-AJ-042: o sandbox exercita a jornada inteira sem transportadora. */
describe('SandboxShippingProvider', () => {
  it('a etiqueta de teste é um PDF que abre — cabeçalho, xref e fim', () => {
    const pdf = simplePdf(['ETIQUETA DE TESTE', 'Pedido GC-1 (ação)']).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('xref');
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toContain('Pedido GC-1 \\(acao\\)');
  });

  it('emite rastreio estável por pedido e direção, com o PDF junto', async () => {
    const provider = new SandboxShippingProvider();
    const ida = await provider.createLabel({ orderNumber: 'GC-1', method: 'X', destinationZipCode: '1' });
    const volta = await provider.createLabel({
      orderNumber: 'GC-1',
      method: 'X',
      destinationZipCode: '1',
      reverse: true,
    });
    expect(ida.trackingCode).toMatch(/^LO\d{9}BR$/);
    expect(volta.trackingCode).toMatch(/^LR\d{9}BR$/);
    expect(ida.label?.format).toBe('PDF');
  });
});
