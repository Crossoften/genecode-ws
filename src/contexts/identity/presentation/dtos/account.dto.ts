import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
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

  /**
   * Data de nascimento (GC-AJ-012, roteiro do QR 1). Opcional no contrato para
   * não quebrar o cadastro da compra sem conta; a tela do QR a exige.
   */
  @ApiPropertyOptional({ example: '1990-05-21' })
  @IsOptional()
  @IsDateString({ strict: true }, { message: 'Data de nascimento inválida.' })
  birthDate?: string;

  /** Sexo biológico (GC-AJ-012). Opcional pelo mesmo motivo. */
  @ApiPropertyOptional({ enum: ['FEMALE', 'MALE'] })
  @IsOptional()
  @IsIn(['FEMALE', 'MALE'], { message: 'Sexo biológico inválido.' })
  biologicalSex?: 'FEMALE' | 'MALE';

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

/**
 * Pedido de reenvio do código de verificação.
 *
 * Só o e-mail: quem está nesta tela ainda não tem sessão, e pedir qualquer outra
 * coisa daria a quem sonda um sinal a mais sobre a conta.
 */
export class ResendVerificationDto {
  @ApiProperty({ example: 'voce@email.com' })
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @IsNotEmpty()
  @MaxLength(255)
  email!: string;
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

/**
 * Conclusão do convite de pré-cadastro.
 *
 * Mesma forma do `ResetPasswordDto` — token do e-mail e senha nova — porque é
 * a mesma operação por baixo: um token de uso único autorizando definir senha.
 * Fica como classe própria para o Swagger descrever a rota pelo que ela é, e
 * para a documentação de uma não mudar quando a outra mudar.
 */
export class ConcluirConviteDto {
  @ApiProperty({ description: 'Token recebido no e-mail de convite.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  token!: string;

  @ApiProperty({ description: 'Senha escolhida pela pessoa.' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

/** Convite de colaborador, da tela de equipe do admin. */
export class ConvidarColaboradorDto {
  @ApiProperty({ description: 'Nome de quem será convidado.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @ApiProperty({ description: 'E-mail para onde o convite vai.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  email!: string;

  @ApiProperty({ description: 'Papel interno: master, admin, finance, orders ou lab.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  papel!: string;
}

export class TrocarPapelDto {
  @ApiProperty({ description: 'Novo papel interno.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  papel!: string;
}

export class DefinirAtivoDto {
  @ApiProperty({ description: 'Ligar ou desligar o acesso.' })
  @IsBoolean()
  ativo!: boolean;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  refreshToken!: string;
}
