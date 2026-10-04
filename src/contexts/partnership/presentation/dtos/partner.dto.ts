import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

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

  /**
   * Token do link de convite, quando a pessoa entra na rede de alguém.
   *
   * Sem ele o parceiro nasce raiz, com o bolo inteiro da rede — que é como
   * todos os parceiros nasciam antes de 03/10.
   */
  @ApiPropertyOptional({ description: 'Token do link de convite.' })
  @IsOptional() @IsString() @MaxLength(128)
  inviteToken?: string;
}

export class CriarConviteDto {
  @ApiProperty({ example: 5, description: 'Fatia do pedido que o convidado recebe, em %.' })
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100)
  sharePercent!: number;

  @ApiPropertyOptional({ example: 'Loja Centro' })
  @IsOptional() @IsString() @MaxLength(120)
  label?: string;
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
