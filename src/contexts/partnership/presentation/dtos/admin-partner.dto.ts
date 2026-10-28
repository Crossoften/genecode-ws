import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNumber, Max, Min } from 'class-validator';

export class SetPartnerActiveDto {
  @ApiProperty({ description: 'true ativa o parceiro, false desativa.' })
  @IsBoolean()
  active!: boolean;
}

export class SetPartnerShareDto {
  @ApiProperty({ description: 'Fatia do pedido, em pontos percentuais (ex.: 35).', example: 35 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  sharePercent!: number;
}
