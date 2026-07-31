import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { IsCpfOrCnpj } from '@shared/validation/is-cpf-or-cnpj.decorator';

export class RegisterPartnerDto {
  @ApiProperty({ enum: ['INDIVIDUAL', 'COMPANY'] })
  @IsIn(['INDIVIDUAL', 'COMPANY'])
  type!: 'INDIVIDUAL' | 'COMPANY';

  @ApiProperty({ example: 'Marina Costa' })
  @IsString() @MinLength(2) @MaxLength(160)
  displayName!: string;

  @ApiProperty({ description: 'CPF para pessoa física, CNPJ para jurídica.' })
  @IsCpfOrCnpj({ message: 'CPF ou CNPJ inválido.' })
  document!: string;

  @ApiPropertyOptional({ example: 'Instagram @marinacosta' })
  @IsOptional() @IsString() @MaxLength(200)
  channel?: string;
}

export class BankDetailsDto {
  @ApiPropertyOptional({ enum: ['CPF_CNPJ', 'EMAIL', 'PHONE', 'RANDOM'] })
  @IsOptional() @IsIn(['CPF_CNPJ', 'EMAIL', 'PHONE', 'RANDOM'])
  pixKeyType?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(140)
  pixKey?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(80)
  bankName?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(20)
  bankBranch?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(30)
  bankAccount?: string;
}
