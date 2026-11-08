import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { IsTelefoneBr, normalizarTelefoneBr, telefoneBrValido } from './telefone-br';

class Dto {
  @IsTelefoneBr()
  phone!: string;
}

/** GC-N05-05: o +55 colado do WhatsApp passava na tela e travava no pagamento. */
describe('telefone brasileiro', () => {
  it.each([
    ['(11) 98765-4321', '11987654321'],
    ['+55 (11) 98765-4321', '11987654321'],
    ['5511987654321', '11987654321'],
    ['0 11 3456-7890', '1134567890'],
    ['11 3456-7890', '1134567890'],
  ])('%s → %s, válido', (raw, digits) => {
    expect(normalizarTelefoneBr(raw)).toBe(digits);
    expect(telefoneBrValido(digits)).toBe(true);
    const dto = plainToInstance(Dto, { phone: raw });
    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.phone).toBe(digits);
  });

  it.each([
    '11 98765-432', // falta dígito
    '11 98765-43210', // sobra dígito
    '(10) 98765-4321', // DDD que não existe
    '(11) 88765-4321', // 11 dígitos sem o 9 do celular
    '(11) 1234-5678', // fixo começando em 1
    'abc',
  ])('%s → inválido', (raw) => {
    const digits = String(normalizarTelefoneBr(raw));
    expect(telefoneBrValido(digits)).toBe(false);
    expect(validateSync(plainToInstance(Dto, { phone: raw }))).not.toHaveLength(0);
  });
});
