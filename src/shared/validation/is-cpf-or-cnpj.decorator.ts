import { registerDecorator, type ValidationOptions } from 'class-validator';
import { cnpj, cpf } from 'cpf-cnpj-validator';

/**
 * Valida CPF ou CNPJ, incluindo os dígitos verificadores.
 *
 * Preservado do backend anterior — era uma das poucas peças que valia a pena
 * manter. Aceita os dois porque o parceiro pode ser pessoa física ou jurídica,
 * e o protótipo da Área do Parceiro alterna o campo conforme o tipo escolhido.
 *
 * @param validationOptions - Opções padrão do class-validator.
 */
export function IsCpfOrCnpj(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isCpfOrCnpj',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          return cpf.isValid(value) || cnpj.isValid(value);
        },
        defaultMessage(): string {
          return 'Informe um CPF ou CNPJ válido.';
        },
      },
    });
  };
}
