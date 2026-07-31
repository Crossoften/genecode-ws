import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class IngestCsvDto {
  @ApiProperty({ example: 'exames_2026_07_31.csv' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  filename!: string;

  @ApiProperty({ enum: ['performance', 'nutrigenetics'] })
  @IsIn(['performance', 'nutrigenetics'])
  panelSlug!: string;

  @ApiProperty({ description: 'Conteúdo do CSV: código do paciente na 1ª coluna, um marcador por coluna seguinte.' })
  @IsString()
  @IsNotEmpty()
  content!: string;
}
