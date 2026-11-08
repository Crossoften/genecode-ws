import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
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
  @ApiProperty({ description: 'challengeId de POST /parceiro/dados-bancarios/confirmacao' })
  @IsString()
  @IsNotEmpty()
  challengeId!: string;

  @ApiProperty({ example: '123456', description: 'Código de 6 dígitos recebido por e-mail' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'O código tem 6 dígitos.' })
  code!: string;

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

/**
 * "Quero ser parceiro" de quem já tem conta (GC-N05-14).
 *
 * Nome, CPF, e-mail e telefone vêm da conta — o formulário só pede o que é de
 * parceiro. `document` só é lido para empresa (CNPJ) ou para conta que ainda
 * não tem CPF.
 */
export class SolicitarParceriaDto {
  @ApiProperty({ enum: ['INDIVIDUAL', 'COMPANY'], default: 'INDIVIDUAL' })
  @IsIn(['INDIVIDUAL', 'COMPANY'])
  type!: 'INDIVIDUAL' | 'COMPANY';

  @ApiProperty({ example: 'Academia Corpo em Forma, Zona Norte', description: 'Onde atua.' })
  @IsString() @MinLength(2) @MaxLength(200)
  channel!: string;

  @ApiPropertyOptional({ description: 'CNPJ (empresa) ou CPF, se a conta ainda não tiver.' })
  @IsOptional() @IsString() @MaxLength(18)
  document?: string;

  @ApiPropertyOptional({ description: 'Nome da empresa. Pessoa física usa o nome da conta.' })
  @IsOptional() @IsString() @MaxLength(160)
  displayName?: string;

  @ApiPropertyOptional({ enum: ['CPF_CNPJ', 'EMAIL', 'PHONE', 'RANDOM'] })
  @IsOptional() @IsIn(['CPF_CNPJ', 'EMAIL', 'PHONE', 'RANDOM'])
  pixKeyType?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(140)
  pixKey?: string;

  @ApiPropertyOptional({ description: 'Observação para quem aprova.' })
  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}
