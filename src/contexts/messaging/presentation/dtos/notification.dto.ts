import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class UpdateTriggerChannelsDto {
  @ApiProperty({ required: false })
  @IsOptional() @IsBoolean()
  whatsapp?: boolean;

  @ApiProperty({ required: false })
  @IsOptional() @IsBoolean()
  email?: boolean;

  @ApiProperty({ required: false })
  @IsOptional() @IsBoolean()
  sms?: boolean;
}

export class UpdateNotificationTriggerDto {
  @ApiProperty({ required: false })
  @IsOptional() @IsBoolean()
  enabled?: boolean;

  @ApiProperty({
    required: false,
    description: 'Texto-modelo com placeholders literais {nome}, {pedido}, {link_rastreio}…',
  })
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(1000)
  template?: string;

  @ApiProperty({ required: false, type: UpdateTriggerChannelsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateTriggerChannelsDto)
  channels?: UpdateTriggerChannelsDto;
}
