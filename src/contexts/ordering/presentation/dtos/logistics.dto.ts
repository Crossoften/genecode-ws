import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class PickupAddressDto {
  @ApiProperty({ example: '01310-100' })
  @Matches(/^\d{5}-?\d{3}$/, { message: 'CEP inválido.' })
  zipCode!: string;

  @ApiProperty() @IsString() @MaxLength(200) street!: string;
  @ApiProperty() @IsString() @MaxLength(20) number!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) complement?: string;
  @ApiProperty() @IsString() @MaxLength(120) neighborhood!: string;
  @ApiProperty() @IsString() @MaxLength(120) city!: string;
  @ApiProperty() @IsString() @Length(2, 2) state!: string;
}

/** Pedido de retirada da amostra na casa do cliente (GC-AJ-041). */
export class SchedulePickupDto {
  @ApiProperty({ example: '2026-11-03' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data inválida.' })
  data!: string;

  @ApiProperty({ enum: ['MANHA', 'TARDE'] })
  @IsIn(['MANHA', 'TARDE'])
  periodo!: 'MANHA' | 'TARDE';

  @ApiPropertyOptional({ example: 'Portaria', maxLength: 80 })
  @IsOptional() @IsString() @MaxLength(80)
  local?: string;

  @ApiPropertyOptional({ type: PickupAddressDto, description: 'Outro endereço na mesma cidade.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => PickupAddressDto)
  endereco?: PickupAddressDto;
}
