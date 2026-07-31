import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Especialidades da autodeclaração.
 *
 * Lista fechada, mas **sem validação de conselho de classe** — decisão do
 * cliente em 16/07. O Dr. Câmara chamou de "princípio do consulado americano":
 * *"a gente vai meio que acreditando no que o cara tá falando"*. O caso de uso
 * que justifica é o ex-atleta que treina corrida sem ser formado.
 *
 * Em contrapartida, o titular aceita um termo de isenção ao autorizar — a
 * plataforma não responde por serviço de terceiro.
 */
export const SPECIALTIES = [
  'personal_trainer',
  'nutricionista',
  'nutrologo',
  'medico',
  'fisioterapeuta',
  'educador_fisico',
  'coach_esportivo',
  'preparador_fisico',
  'tecnico_esportivo',
  'outro',
] as const;

export class CreateProfessionalDto {
  @ApiProperty({ enum: SPECIALTIES })
  @IsIn(SPECIALTIES)
  specialty!: string;

  @ApiPropertyOptional({ description: 'Registro de conselho. Não é validado nem obrigatório.' })
  @IsOptional() @IsString() @MaxLength(40)
  councilId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(500)
  bio?: string;
}

export class GrantSharingDto {
  @ApiProperty({ example: 'personal@email.com' })
  @IsEmail() @MaxLength(255)
  professionalEmail!: string;
}
