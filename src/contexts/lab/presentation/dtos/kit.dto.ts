import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class ActivateKitDto {
  /**
   * Código impresso na etiqueta do kit.
   *
   * A validação aqui é deliberadamente frouxa — só garante que é texto de
   * tamanho razoável. O cliente especificou **quatro** mensagens distintas
   * ("Formato Incorreto.", "Apenas Números.", "Código Válido.", "Código Errado,
   * Digite Novamente."), e classificar qual delas cabe é regra de domínio.
   *
   * Um regex aqui curto-circuitaria a classificação: `12A456-01` voltaria como
   * "Formato Incorreto." quando a especificação manda "Apenas Números.".
   */
  @ApiProperty({ example: '482913-47', description: 'Código impresso na etiqueta do kit.' })
  @IsString()
  @MaxLength(20)
  code!: string;
}

export class GenerateKitsDto {
  @ApiProperty({ example: 500 })
  @IsInt() @Min(1) @Max(5000)
  quantity!: number;

  @ApiProperty({ example: 'LOTE-2026-07' })
  @IsString() @MinLength(3) @MaxLength(40)
  reference!: string;
}
