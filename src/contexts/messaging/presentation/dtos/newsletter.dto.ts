import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Origens aceitas. Fechado de propósito: é o que aparece no CSV do admin. */
export const NEWSLETTER_SOURCES = ['rodape'] as const;

export class SubscribeNewsletterDto {
  @ApiProperty({ example: 'maria@exemplo.com.br' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ description: 'Precisa ser true: a inscrição só existe com o aceite.' })
  @Equals(true, { message: 'É preciso aceitar receber as novidades.' })
  consent!: boolean;

  @ApiProperty({
    description: 'Texto do aceite exatamente como a pessoa viu ao lado do campo.',
    example: 'Quero receber novidades da gene.code por e-mail.',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(300)
  consentText!: string;

  @ApiProperty({ required: false, enum: NEWSLETTER_SOURCES, default: 'rodape' })
  @IsOptional()
  @IsIn(NEWSLETTER_SOURCES)
  source?: (typeof NEWSLETTER_SOURCES)[number];
}
