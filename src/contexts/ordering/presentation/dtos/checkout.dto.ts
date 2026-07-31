import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsIn, IsInt, IsOptional,
  IsString, Length, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';

import { IsCpfOrCnpj } from '@shared/validation/is-cpf-or-cnpj.decorator';

export class CustomerDto {
  @ApiProperty({ example: 'Ana Martins' })
  @IsString() @MinLength(2) @MaxLength(160)
  name!: string;

  @ApiProperty({ example: 'ana@email.com' })
  @IsEmail() @MaxLength(255)
  email!: string;

  @ApiProperty({ example: '123.456.789-00' })
  @IsCpfOrCnpj({ message: 'CPF ou CNPJ inválido.' })
  document!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(20)
  phone?: string;
}

export class AddressDto {
  @ApiProperty({ example: '01310-100' })
  @Matches(/^\d{5}-?\d{3}$/, { message: 'CEP inválido.' })
  zipCode!: string;

  @ApiProperty() @IsString() @MaxLength(200) street!: string;
  @ApiProperty() @IsString() @MaxLength(20) number!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) complement?: string;
  @ApiProperty() @IsString() @MaxLength(120) neighborhood!: string;
  @ApiProperty() @IsString() @MaxLength(120) city!: string;

  @ApiProperty({ example: 'SP' })
  @IsString() @Length(2, 2, { message: 'UF deve ter 2 letras.' })
  state!: string;
}

export class CartItemDto {
  @ApiProperty({ example: 'performance' })
  @IsString() @MaxLength(80)
  productSlug!: string;

  @ApiProperty({ example: 1 })
  @IsInt() @Min(1) @Max(10)
  quantity!: number;
}

export class PaymentDto {
  @ApiProperty({ enum: ['CREDIT_CARD', 'PIX', 'BOLETO'] })
  @IsIn(['CREDIT_CARD', 'PIX', 'BOLETO'])
  method!: 'CREDIT_CARD' | 'PIX' | 'BOLETO';

  @ApiProperty({ example: 12 })
  @IsInt() @Min(1) @Max(12)
  installments!: number;

  @ApiPropertyOptional({
    description: 'Token gerado pelo SDK da adquirente no navegador. Nunca o número do cartão.',
  })
  @IsOptional() @IsString() @MaxLength(200)
  cardToken?: string;
}

export class CheckoutDto {
  @ApiProperty({ type: CustomerDto })
  @ValidateNested() @Type(() => CustomerDto)
  customer!: CustomerDto;

  @ApiProperty({ type: AddressDto })
  @ValidateNested() @Type(() => AddressDto)
  address!: AddressDto;

  @ApiProperty({ type: [CartItemDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10)
  @ValidateNested({ each: true }) @Type(() => CartItemDto)
  items!: CartItemDto[];

  @ApiProperty({ enum: ['STANDARD', 'EXPRESS'] })
  @IsIn(['STANDARD', 'EXPRESS'])
  shippingCode!: string;

  @ApiPropertyOptional({ example: 'PARCEIRO10' })
  @IsOptional() @IsString() @MaxLength(40)
  couponCode?: string;

  @ApiProperty({ type: PaymentDto })
  @ValidateNested() @Type(() => PaymentDto)
  payment!: PaymentDto;
}

export class ShippingQuoteDto {
  @ApiProperty({ example: '01310-100' })
  @Matches(/^\d{5}-?\d{3}$/, { message: 'CEP inválido.' })
  zipCode!: string;
}
