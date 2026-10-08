import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Login payload.
 *
 * Deliberately shallow: password strength is a domain rule enforced by the
 * `Password` value object at signup, not here. Applying it on login would reject
 * legitimate older passwords and leak the policy to attackers.
 */
export class LoginDto {
  @ApiProperty({ example: 'ana@email.com' })
  @IsEmail({}, { message: 'E-mail inválido.' })
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: '••••••••' })
  @IsString()
  @IsNotEmpty({ message: 'Senha é obrigatória.' })
  @MaxLength(128)
  password!: string;
}

export class RefreshDto {
  @ApiProperty({ description: 'Refresh token opaco recebido no login.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  refreshToken!: string;
}

export class AuthenticatedUserDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ type: [String] }) roles!: string[];
  @ApiProperty({ type: [String] }) permissions!: string[];
}

export class AuthResponseDto {
  @ApiProperty({ type: AuthenticatedUserDto }) user!: AuthenticatedUserDto;
  @ApiProperty() accessToken!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ example: '15m' }) expiresIn!: string;
}

/**
 * Resposta do login quando a conta exige a segunda etapa.
 *
 * **Não traz token.** A sessão só nasce em `POST /auth/login/verificacao`,
 * depois que o código confere.
 */
export class TwoFactorChallengeDto {
  @ApiProperty({ example: true }) twoFactorRequired!: true;
  @ApiProperty({ description: 'Identificador do desafio, devolvido na verificação' })
  challengeId!: string;
  @ApiProperty({ example: 'pa•••••@email.com' }) maskedEmail!: string;
  @ApiProperty({ example: 600 }) expiresInSeconds!: number;
  @ApiProperty({ required: false, description: 'Só com MOSTRAR_CODIGO_VERIFICACAO=YES' })
  codigoDeTeste?: string;
}

export class VerifyTwoFactorDto {
  @ApiProperty({ description: 'O challengeId devolvido pelo login' })
  @IsString()
  @IsNotEmpty()
  challengeId!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'O código tem 6 dígitos.' })
  code!: string;
}
