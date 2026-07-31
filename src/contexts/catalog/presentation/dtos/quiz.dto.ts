import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsString, MaxLength, ValidateNested } from 'class-validator';

export class QuizAnswerDto {
  @ApiProperty({ example: 'objetivo' })
  @IsString()
  @MaxLength(40)
  questionId!: string;

  @ApiProperty({ example: 'treino' })
  @IsString()
  @MaxLength(40)
  optionId!: string;
}

export class QuizAnswersDto {
  @ApiProperty({ type: [QuizAnswerDto] })
  @IsArray()
  // O quiz tem 3 perguntas; o limite existe só para evitar payload inflado.
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => QuizAnswerDto)
  answers!: QuizAnswerDto[];
}
