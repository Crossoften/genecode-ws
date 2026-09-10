import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateProductDto {
  @ApiProperty({ maxLength: 60, example: 'GeneCode Premium' })
  @IsString() @MinLength(2) @MaxLength(60)
  name!: string;

  @ApiProperty({ maxLength: 160, description: 'Descrição curta do cartão da vitrine.' })
  @IsString() @MaxLength(160)
  summary!: string;

  @ApiProperty({ description: 'Descrição completa da página do produto.' })
  @IsString()
  description!: string;

  // 300 acompanha o VarChar(300) da coluna: o item de acompanhamentos de
  // performance (09/09) passa de 200 caracteres e o André pediu para não
  // quebrá-lo em vários itens.
  @ApiPropertyOptional({ type: [String], description: 'O que está incluso, um item por linha.' })
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(300, { each: true })
  features?: string[];

  @ApiPropertyOptional({ description: 'Quantidade de marcadores anunciada.' })
  @IsOptional() @IsInt() @Min(0)
  markerCount?: number;

  @ApiProperty({ description: 'Preço em centavos.', example: 59_900 })
  @IsInt() @IsPositive()
  priceCents!: number;

  @ApiPropertyOptional({ description: 'Preço promocional em centavos.' })
  @IsOptional() @IsInt() @IsPositive()
  promoPriceCents?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 12 })
  @IsOptional() @IsInt() @Min(1) @Max(12)
  maxInstallments?: number;

  @ApiPropertyOptional({ maxLength: 40, example: 'Mais vendido' })
  @IsOptional() @IsString() @MaxLength(40)
  highlight?: string;

  @ApiPropertyOptional({ maxLength: 500, description: 'URL de imagem já hospedada.' })
  @IsOptional() @IsString() @MaxLength(500)
  imageUrl?: string;

  @ApiPropertyOptional({ description: 'Peso do kit em gramas.' })
  @IsOptional() @IsInt() @IsPositive()
  weightGrams?: number;

  @ApiPropertyOptional({ maxLength: 20, example: '18 × 12 × 4' })
  @IsOptional() @IsString() @MaxLength(20)
  dimensionsCm?: string;

  @ApiPropertyOptional({ maxLength: 40, example: 'Completo' })
  @IsOptional() @IsString() @MaxLength(40)
  category?: string;
}

export class CreateProductDto extends UpdateProductDto {
  @ApiPropertyOptional({
    description: 'Derivado do nome quando ausente.',
    example: 'genecode-premium',
  })
  @IsOptional() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @MaxLength(80)
  slug?: string;
}

export class SetProductStateDto {
  @ApiPropertyOptional({ description: 'Publica ou despublica na vitrine.' })
  @IsOptional() @IsBoolean()
  published?: boolean;

  @ApiPropertyOptional({ description: 'Arquivar também despublica.' })
  @IsOptional() @IsBoolean()
  archived?: boolean;
}
