import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';

export interface SubscribeNewsletterInput {
  readonly email: string;
  readonly source: string;
  readonly consentText: string;
}

/**
 * Resposta única do "Fique por dentro" (GC-N05-17).
 *
 * É a mesma para e-mail novo e para e-mail que já estava na lista. O
 * formulário é público: se a resposta mudasse, qualquer um descobriria quem já
 * se inscreveu — e, por tabela, quem é cliente da gene.code.
 */
export const NEWSLETTER_RESPONSE = Object.freeze({
  ok: true as const,
  message: 'Pronto! Você vai receber as novidades da gene.code neste e-mail.',
});

/** Normaliza o e-mail como ele é gravado: sem espaços e em minúsculas. */
export function normalizeNewsletterEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Inscreve um e-mail na newsletter do rodapé.
 *
 * Idempotente: inscrever de novo não duplica a linha nem regrava a origem ou a
 * data do primeiro aceite. Usa `createMany` com `skipDuplicates` (INSERT IGNORE
 * no MySQL) em vez de "procura, depois cria" — dois envios simultâneos do mesmo
 * e-mail não estouram a chave única nem viram 500.
 */
@Injectable()
export class SubscribeNewsletterUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(input: SubscribeNewsletterInput): Promise<typeof NEWSLETTER_RESPONSE> {
    await this.prisma.newsletterSubscription.createMany({
      data: [
        {
          email: normalizeNewsletterEmail(input.email),
          source: input.source,
          consentText: input.consentText,
          consentedAt: new Date(),
        },
      ],
      skipDuplicates: true,
    });
    return NEWSLETTER_RESPONSE;
  }
}
