import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';

/**
 * Lista de inscritos da newsletter em CSV, para o admin importar na
 * ferramenta de e-mail que o cliente escolher (GC-N05-17).
 *
 * Separador `;` e BOM UTF-8 porque o destino mais provável é o Excel em
 * português, que abre `,` numa coluna só e estraga os acentos sem o BOM.
 */
@Injectable()
export class ExportNewsletterUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(): Promise<string> {
    const rows = await this.prisma.newsletterSubscription.findMany({
      orderBy: { createdAt: 'asc' },
      select: { email: true, source: true, consentText: true, consentedAt: true },
    });

    const lines = [
      ['email', 'origem', 'consentimento', 'consentido_em'],
      ...rows.map((row) => [row.email, row.source, row.consentText, row.consentedAt.toISOString()]),
    ];
    return '﻿' + lines.map((cells) => cells.map(csvCell).join(';')).join('\r\n') + '\r\n';
  }
}

/**
 * Escapa uma célula de CSV.
 *
 * Além das aspas, neutraliza fórmula: o e-mail vem de formulário público, e uma
 * célula começando com `=`, `+`, `-` ou `@` vira fórmula no Excel de quem abrir.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
