import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class QuestionOptionDto {
  @ApiProperty({ example: 'Todos os dias' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;

  @ApiProperty({ example: 100, description: 'Qualidade do hábito: 0 (pior) a 100 (melhor).' })
  @IsInt()
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
  @ApiProperty({ example: 'Q0', enum: ['Q0', 'Q1', 'Q2', 'Q3', 'Q4'] })
  @IsString()
  checkpoint!: string;

  @ApiProperty({ type: [AnswerDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers!: AnswerDto[];
}
