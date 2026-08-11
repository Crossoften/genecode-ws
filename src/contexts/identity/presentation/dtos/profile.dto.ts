import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

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
