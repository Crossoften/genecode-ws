import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Os cinco checkpoints da entrevista, na ordem em que liberam. */
export const CHECKPOINTS = ['Q0', 'Q1', 'Q2', 'Q3', 'Q4'] as const;

export class QuestionOptionDto {
  @ApiProperty({ example: 'Todos os dias' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;

  /**
   * Aceita fracionário: a pontuação por posição da especificação (§3.3) usa 66,7
   * e 33,3, e um `@IsInt` aqui recusaria a própria pergunta semeada quando o
   * laboratório abrisse para editar.
   */
  @ApiProperty({ example: 66.7, description: 'Qualidade do hábito: 0 (pior) a 100 (melhor).' })
  @IsNumber()
  @Min(0)
  @Max(100)
  points!: number;
}

export class QuestionDto {
  @ApiProperty({ example: 'nutrigenetics' })
  @IsString()
  @MaxLength(64)
  panelSlug!: string;

  @ApiProperty({ example: 'metabolismo_energetico' })
  @IsString()
  @MaxLength(80)
  categorySlug!: string;

  @ApiProperty({ example: 'Com que frequência você pratica atividade física?' })
  @IsString()
  @MinLength(3)
  @MaxLength(400)
  text!: string;

  @ApiProperty({ example: 1, description: 'Peso da pergunta dentro da categoria.' })
  @IsNumber()
  @Min(0.1)
  @Max(10)
  weight!: number;

  @ApiProperty({ type: [QuestionOptionDto] })
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options!: QuestionOptionDto[];
}

export class AnswerDto {
  @ApiProperty()
  @IsString()
  questionId!: string;

  @ApiProperty()
  @IsString()
  optionId!: string;
}

export class SubmitAssessmentDto {
  @ApiProperty({ example: 'Q0', enum: CHECKPOINTS })
  @IsIn(CHECKPOINTS)
  checkpoint!: string;

  @ApiProperty({ type: [AnswerDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers!: AnswerDto[];
}
