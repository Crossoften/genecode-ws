import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetPartnerActiveDto {
  @ApiProperty({ description: 'true ativa o parceiro, false desativa.' })
  @IsBoolean()
  active!: boolean;
}
