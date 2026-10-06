import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { hash } from 'bcrypt';

/**
 * 50 titulares com kit ativado, aguardando o CSV do laboratório.
 *
 * Pedido do André na reunião de 29/09 — a Genoa quer que o Flávio teste a
 * submissão dos CSVs em homologação com volume de verdade, e não com os dois ou
 * três titulares das sementes de demonstração.
 *
 * Cada conta nasce no estado exato em que o laboratório a encontra na vida real:
 *
 *   conta verificada → pedido pago → kit despachado e **ativado** → amostra
 *   recebida → nenhum laudo
 *
 * É esse estado que faz o pedido aparecer na *Fila de amostras* com o código do
 * kit ao lado, e é o código do kit que vai na primeira coluna do CSV.
 *
 * ### Determinístico, e por quê
 *
 * E-mails, números de pedido e **códigos de kit** vêm prontos de
 * `data/lab50.json`, gerado por `docs/13-csv-laboratorio/scripts/gerar-arquivos.mjs`.
 * Nada é sorteado aqui. Isso é o que permite o PDF entregue ao cliente listar os
 * 50 códigos antes de o seed rodar, e permite reenviar o mesmo CSV e obter o
 * mesmo laudo.
 *
 * ### Idempotente e aditivo
 *
 * Tudo por `upsert` ou por checagem de existência. Rodar duas vezes não duplica
 * pedido nem kit, e **nada é apagado** — homolog tem dados de outros testes.
 *
 * ### Opt-in
 *
 * Só roda com `LAB50_SEED=YES`. O guarda não é `NODE_ENV`: o `.env` de
 * homologação diz `production`, e checar isso impediria justamente o uso para o
 * qual a semente existe.
 *
 * ```bash
 * LAB50_SEED=YES npx ts-node -r tsconfig-paths/register prisma/seeds/lab50.seed.ts
 * ```
 */
const prisma = new PrismaClient();

interface Conta {
  readonly indice: number;
  readonly nome: string;
  readonly email: string;
  readonly senha: string;
  readonly kit: string;
  readonly pedido: string;
  readonly cpf: string;
  readonly produtoSlug: string;
  readonly produtoNome: string;
  readonly produtoCents: number;
  readonly painel: string;
}

const CONTAS: readonly Conta[] = JSON.parse(
  readFileSync(join(__dirname, 'data', 'lab50.json'), 'utf8'),
) as Conta[];

const LOTE = 'LAB50';

/**
 * Trilha de eventos até "amostra recebida".
 *
 * A fila do laboratório ordena por `updatedAt` e mostra a data do evento
 * `SAMPLE_RECEIVED`. Escalonar os dias faz a fila chegar ordenada, como chegaria
 * se as 50 amostras tivessem entrado ao longo de duas semanas — uma fila em que
 * as 50 linhas têm o mesmo horário não se parece com nada que o laboratório vá
 * ver em produção.
 */
function trilha(indice: number): { status: OrderStatusLiteral; dias: number }[] {
  const base = 26 - Math.floor(indice / 4); // ~4 amostras por dia
  return [
    { status: 'PAID', dias: base },
    { status: 'KIT_SHIPPED', dias: base - 2 },
    { status: 'KIT_DELIVERED', dias: base - 5 },
    { status: 'SAMPLE_IN_TRANSIT', dias: base - 8 },
    { status: 'SAMPLE_RECEIVED', dias: base - 11 },
  ];
}

type OrderStatusLiteral =
  'PAID' | 'KIT_SHIPPED' | 'KIT_DELIVERED' | 'SAMPLE_IN_TRANSIT' | 'SAMPLE_RECEIVED';

const diasAtras = (d: number): Date => new Date(Date.now() - d * 86_400_000);

async function main(): Promise<void> {
  if (process.env.LAB50_SEED !== 'YES') {
    console.error('Semente protegida. Use LAB50_SEED=YES para rodar.');
    process.exitCode = 1;
    return;
  }

  const papel = await prisma.role.findUnique({ where: { slug: 'patient' } });
  if (!papel) throw new Error('O papel "patient" não existe — rode a semente principal primeiro.');

  // Os painéis são o que transforma o CSV em laudo. Sem eles publicados, a
  // importação recusa o arquivo inteiro — melhor falhar aqui, com o motivo, do
  // que entregar 50 contas que não produzem nada.
  for (const slug of new Set(CONTAS.map((c) => c.painel))) {
    const painel = await prisma.panel.findFirst({ where: { slug, status: 'PUBLISHED' } });
    if (!painel) throw new Error(`Painel "${slug}" não está publicado neste banco.`);
  }

  const lote = await prisma.kitBatch.upsert({
    where: { reference: LOTE },
    update: {},
    create: { reference: LOTE, notes: '50 kits para o teste de importação de CSV do laboratório' },
  });

  // A senha é a mesma para as 50 contas; gerar o hash uma vez evita 50 rodadas
  // de bcrypt com fator 12, que levariam minutos sem nenhum ganho.
  const senhaHash = await hash(CONTAS[0]!.senha, 12);

  let pedidosNovos = 0;

  for (const conta of CONTAS) {
    const user = await prisma.user.upsert({
      where: { email: conta.email },
      update: { status: 'ACTIVE', emailVerifiedAt: new Date(), name: conta.nome },
      create: {
        email: conta.email,
        name: conta.nome,
        password: senhaHash,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });

    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: papel.id } },
      update: {},
      create: { userId: user.id, roleId: papel.id },
    });

    // O titular é identificado pelo código do kit. É esse valor que o CSV traz
    // na primeira coluna, e é por ele que o laudo encontra o dono.
    let subject = await prisma.subject.findFirst({ where: { externalCode: conta.kit } });
    subject ??= await prisma.subject.create({ data: { externalCode: conta.kit } });

    await prisma.subjectLink.upsert({
      where: { userId_subjectId: { userId: user.id, subjectId: subject.id } },
      update: {},
      create: { userId: user.id, subjectId: subject.id, relation: 'SELF' },
    });

    const existente = await prisma.order.findUnique({ where: { number: conta.pedido } });
    if (!existente) {
      const eventos = trilha(conta.indice);
      const pedido = await prisma.order.create({
        data: {
          number: conta.pedido,
          userId: user.id,
          customerName: conta.nome,
          customerEmail: conta.email,
          customerDoc: conta.cpf,
          status: 'SAMPLE_RECEIVED',
          subtotalCents: conta.produtoCents,
          totalCents: conta.produtoCents,
          createdAt: diasAtras(eventos[0]!.dias),
          paidAt: diasAtras(eventos[0]!.dias),
          items: {
            create: {
              productSlug: conta.produtoSlug,
              productName: conta.produtoNome,
              unitCents: conta.produtoCents,
            },
          },
          events: {
            create: eventos.map((e) => ({
              status: e.status,
              actor: 'system',
              createdAt: diasAtras(e.dias),
            })),
          },
        },
      });
      pedidosNovos += 1;

      const kitExistente = await prisma.kit.findUnique({ where: { code: conta.kit } });
      if (kitExistente) {
        throw new Error(
          `O kit ${conta.kit} já existe neste banco e não pertence a esta semente. ` +
            'Mude a faixa de códigos em gerar-arquivos.mjs.',
        );
      }

      await prisma.kit.create({
        data: {
          code: conta.kit,
          batchId: lote.id,
          status: 'ACTIVATED',
          orderId: pedido.id,
          subjectId: subject.id,
          activatedByUserId: user.id,
          activatedAt: diasAtras(eventos[2]!.dias),
        },
      });
    }

    const marca = existente ? '·' : '✓';
    console.log(
      `${marca} ${conta.email.padEnd(24)} kit ${conta.kit}  ${conta.pedido}  ${conta.painel}`,
    );
  }

  const fila = await prisma.order.count({ where: { status: 'SAMPLE_RECEIVED' } });

  console.log(
    `\n${CONTAS.length} contas conferidas · ${pedidosNovos} pedidos criados nesta rodada`,
  );
  console.log(`Senha de todas: ${CONTAS[0]!.senha}`);
  console.log(`Fila do laboratório agora: ${fila} amostras aguardando CSV`);
  console.log('Arquivos para subir: docs/13-csv-laboratorio/arquivos/');
}

main()
  .catch((erro) => {
    console.error('lab50 seed falhou:', erro);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
