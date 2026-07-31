import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { IsCpfOrCnpj } from '@shared/validation/is-cpf-or-cnpj.decorator';

export class AcceptedConsentDto {
  @ApiProperty({ example: 'TERMS_OF_USE' })
  @IsString()
  @MaxLength(40)
  type!: string;

  @ApiProperty({ example: '1.0' })
  @IsString()
  @MaxLength(20)
  version!: string;
}

export class RegisterDto {
  @ApiProperty({ example: 'Ana Martins' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @ApiProperty({ example: 'ana@email.com' })
  @IsEmail({}, { message: 'E-mail inválido.' })
  @MaxLength(255)
  email!: string;

  @ApiProperty({ description: 'Mínimo 8 caracteres, com maiúscula e número.' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({ example: '123.456.789-00' })
  @IsOptional()
  @IsCpfOrCnpj({ message: 'CPF ou CNPJ inválido.' })
  document?: string;

  @ApiPropertyOptional({ example: '+5511999998888' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiProperty({ type: [AcceptedConsentDto] })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AcceptedConsentDto)
  acceptedConsents!: AcceptedConsentDto[];
}

export class VerifyEmailDto {
  @ApiProperty({ example: 'ana@email.com' })
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6, { message: 'O código tem 6 dígitos.' })
  code!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'ana@email.com' })
  @IsEmail()
  @MaxLength(255)
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token recebido por e-mail.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  token!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  refreshToken!: string;
}
