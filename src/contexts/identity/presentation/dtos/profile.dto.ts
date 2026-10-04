import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Ana Martins' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ example: '(11) 99876-5432' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ example: 'Rua das Acácias, 220 — São Paulo/SP' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine?: string;

  @ApiPropertyOptional({ example: '04567-000' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{5}-?\d{3}$/, { message: 'CEP inválido.' })
  addressZip?: string;
}


export class ChangePasswordDto {
  @ApiProperty({ description: 'Senha atual, para confirmar que é a pessoa.' })
  @IsString()
  currentPassword!: string;

  @ApiProperty({ description: 'Nova senha — mesma política do cadastro.' })
  @IsString()
  newPassword!: string;
}

export class NotificationPrefsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() email?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() whatsapp?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() sms?: boolean;
}
