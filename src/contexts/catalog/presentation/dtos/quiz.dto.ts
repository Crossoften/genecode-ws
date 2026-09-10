import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsString,
  ValidateNested,
} from 'class-validator';

import { QUIZ_OPTION_IDS, QUIZ_STATEMENT_COUNT, QUIZ_STATEMENT_IDS } from '../../domain/quiz';

export class QuizAnswerDto {
  @ApiProperty({ example: 'perf-1', enum: [...QUIZ_STATEMENT_IDS] })
  @IsString()
  // Conjunto fechado: id de afirmação errado pontuaria zero em silêncio e
  // devolveria uma recomendação plausível calculada sobre resposta perdida.
  @IsIn(QUIZ_STATEMENT_IDS)
  questionId!: string;

  @ApiProperty({ example: 'sim', enum: [...QUIZ_OPTION_IDS] })
  @IsString()
  @IsIn(QUIZ_OPTION_IDS)
  optionId!: string;
}

export class QuizAnswersDto {
  @ApiProperty({
    type: [QuizAnswerDto],
    minItems: QUIZ_STATEMENT_COUNT,
    maxItems: QUIZ_STATEMENT_COUNT,
  })
  @IsArray()
  // Exatamente as 12 afirmações do quiz novo (material de set/2026), cada uma
  // uma única vez. Antes havia @ArrayMaxSize(10) com o comentário "o quiz tem 3
  // perguntas": com o quiz novo, todo envio válido virava 400.
  //
  // Não há afirmação opcional: o corte em 7 pontos só significa alguma coisa com
  // o bloco inteiro respondido, e faltar uma resposta empurraria o resultado
  // para baixo sem que ninguém percebesse.
  @ArrayMinSize(QUIZ_STATEMENT_COUNT)
  @ArrayMaxSize(QUIZ_STATEMENT_COUNT)
  @ArrayUnique((answer: QuizAnswerDto) => answer.questionId)
  @ValidateNested({ each: true })
  @Type(() => QuizAnswerDto)
  answers!: QuizAnswerDto[];
}
