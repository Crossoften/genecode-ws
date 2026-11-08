import type { PrismaService } from '@infra/database/prisma.service';

import { csvCell, ExportNewsletterUseCase } from './export-newsletter.use-case';
import { NEWSLETTER_RESPONSE, SubscribeNewsletterUseCase } from './subscribe-newsletter.use-case';

/**
 * O que importa no "Fique por dentro" (GC-N05-17): e-mail repetido não vira
 * linha nova nem regrava o primeiro aceite, e a resposta não deixa ninguém
 * descobrir se o e-mail já estava na lista.
 *
 * O fake imita o `createMany({ skipDuplicates })` do MySQL: a chave única é o
 * e-mail, e a linha repetida é ignorada em silêncio.
 */
describe('SubscribeNewsletterUseCase', () => {
  interface Row {
    email: string;
    source: string;
    consentText: string;
    consentedAt: Date;
    createdAt: Date;
  }

  function buildPrisma() {
    const rows: Row[] = [];
    const createMany = jest.fn(
      async ({
        data,
        skipDuplicates,
      }: {
        data: Omit<Row, 'createdAt'>[];
        skipDuplicates?: boolean;
      }) => {
        let count = 0;
        for (const item of data) {
          if (rows.some((row) => row.email === item.email)) {
            if (!skipDuplicates) throw new Error('Unique constraint failed on email');
            continue;
          }
          rows.push({ ...item, createdAt: new Date() });
          count += 1;
        }
        return { count };
      },
    );
    const findMany = jest.fn(async () => [...rows]);
    return { rows, prisma: { newsletterSubscription: { createMany, findMany } } };
  }

  const consentText = 'Quero receber novidades da gene.code por e-mail.';

  it('grava o e-mail normalizado com origem, aceite e data', async () => {
    const { rows, prisma } = buildPrisma();
    const useCase = new SubscribeNewsletterUseCase(prisma as unknown as PrismaService);

    await useCase.execute({ email: '  Maria@Exemplo.COM.br ', source: 'rodape', consentText });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: 'maria@exemplo.com.br', source: 'rodape', consentText });
    expect(rows[0]!.consentedAt).toBeInstanceOf(Date);
    expect(prisma.newsletterSubscription.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it('e-mail repetido não duplica e não regrava o primeiro aceite', async () => {
    const { rows, prisma } = buildPrisma();
    const useCase = new SubscribeNewsletterUseCase(prisma as unknown as PrismaService);

    await useCase.execute({ email: 'joao@exemplo.com', source: 'rodape', consentText });
    const firstConsent = rows[0]!.consentedAt;
    await useCase.execute({
      email: 'JOAO@exemplo.com',
      source: 'rodape',
      consentText: 'outro texto qualquer',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.consentText).toBe(consentText);
    expect(rows[0]!.consentedAt).toBe(firstConsent);
  });

  it('responde igual para e-mail novo e para e-mail que já existia', async () => {
    const { prisma } = buildPrisma();
    const useCase = new SubscribeNewsletterUseCase(prisma as unknown as PrismaService);

    const novo = await useCase.execute({ email: 'ana@exemplo.com', source: 'rodape', consentText });
    const repetido = await useCase.execute({
      email: 'ana@exemplo.com',
      source: 'rodape',
      consentText,
    });

    expect(novo).toEqual(NEWSLETTER_RESPONSE);
    expect(repetido).toEqual(novo);
    // Nada na resposta fala de "já inscrito", contagem ou id.
    expect(Object.keys(repetido).sort()).toEqual(['message', 'ok']);
    expect(repetido.message).not.toMatch(/já|existe|cadastrad/i);
  });

  it('o CSV do admin traz uma linha por e-mail, com BOM e `;`', async () => {
    const { prisma } = buildPrisma();
    const subscribe = new SubscribeNewsletterUseCase(prisma as unknown as PrismaService);
    await subscribe.execute({ email: 'a@exemplo.com', source: 'rodape', consentText });
    await subscribe.execute({ email: 'a@exemplo.com', source: 'rodape', consentText });
    await subscribe.execute({ email: 'b@exemplo.com', source: 'rodape', consentText });

    const csv = await new ExportNewsletterUseCase(prisma as unknown as PrismaService).execute();
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n');

    expect(csv.startsWith('﻿')).toBe(true);
    expect(lines[0]).toBe('email;origem;consentimento;consentido_em');
    expect(lines).toHaveLength(3);
  });

  it('a célula do CSV neutraliza fórmula e escapa aspas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+5511')).toBe("'+5511");
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('maria@exemplo.com')).toBe('maria@exemplo.com');
  });
});
