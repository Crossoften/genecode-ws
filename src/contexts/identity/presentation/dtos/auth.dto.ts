import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

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
