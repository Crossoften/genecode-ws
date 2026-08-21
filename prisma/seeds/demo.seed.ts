import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { hash } from 'bcrypt';

/**
 * Contas de demonstração para o cliente testar tudo e dar feedback.
 *
 * ### Por que é um seed separado e explícito
 *
 * O homolog roda como `NODE_ENV=production`, e o seed principal se recusa a
 * criar contas com senha conhecida nesse ambiente — proteção correta, que fica.
 * Este arquivo é o caminho deliberado: só roda com `DEMO_SEED=YES` na linha de
 * comando, e é **idempotente e aditivo** — faz `upsert` por e-mail e nunca apaga
 * nada, para conviver com os usuários reais que já existem na base.
 *
 * ### O que monta
 *
 * Uma conta por papel no padrão `papel@email.com` / `12345678`, mais três
 * pacientes (`paciente1..3`) para o cliente exercitar o fluxo de **vincular um
 * paciente a um treinador**. O `paciente1` já vem compartilhado com o treinador
 * (a lista "Meus alunos" não nasce vazia); `paciente2` e `paciente3` ficam sem
 * compartilhar, para o cliente testar a autorização pela tela de privacidade.
 *
 * Os laudos dos três pacientes **não** são criados aqui: os `Subject` nascem com
 * `externalCode` `DEMO-P1..3`, e o CSV `demo-genotipos-performance.csv` é subido
 * pela área do laboratório depois do deploy — o `resolveSubject` casa pelo
 * `externalCode` e publica o laudo no titular certo.
 *
 * ⚠️ Nunca rode contra produção de verdade. A trava é opt-in explícito, não
 * `NODE_ENV`, justamente porque homolog *é* production para o Nest.
 */
const prisma = new PrismaClient();

/** Senha única de todas as contas de demonstração. */
const SENHA = '12345678';

interface ContaDemo {
  readonly email: string;
  readonly nome: string;
  readonly papeis: readonly string[];
}

const CONTAS: readonly ContaDemo[] = [
  { email: 'master@email.com', nome: 'Master Demo', papeis: ['master'] },
  { email: 'admin@email.com', nome: 'Admin Demo', papeis: ['admin'] },
  { email: 'lab@email.com', nome: 'Laboratório Demo', papeis: ['lab'] },
  { email: 'treinador@email.com', nome: 'Treinador Demo', papeis: ['professional'] },
  { email: 'parceiro@email.com', nome: 'Parceiro Demo', papeis: ['affiliate'] },
  { email: 'paciente@email.com', nome: 'Paciente Demo', papeis: ['patient'] },
  { email: 'paciente1@email.com', nome: 'Paciente Um', papeis: ['patient'] },
  { email: 'paciente2@email.com', nome: 'Paciente Dois', papeis: ['patient'] },
  { email: 'paciente3@email.com', nome: 'Paciente Três', papeis: ['patient'] },
];

/** Pacientes com laudo, na ordem em que o CSV demo os traz. */
const PACIENTES_COM_LAUDO = [
  { email: 'paciente1@email.com', code: 'DEMO-P1', order: 'GC-DEMO-0001', shareComTreinador: true },
  { email: 'paciente2@email.com', code: 'DEMO-P2', order: 'GC-DEMO-0002', shareComTreinador: false },
  { email: 'paciente3@email.com', code: 'DEMO-P3', order: 'GC-DEMO-0003', shareComTreinador: false },
] as const;

const PRODUTO = { slug: 'performance', nome: 'GeneCode Performance', cents: 46_800 } as const;

async function criarConta(conta: ContaDemo): Promise<string> {
  const user = await prisma.user.upsert({
    where: { email: conta.email },
    update: { status: 'ACTIVE', emailVerifiedAt: new Date() },
    create: {
      email: conta.email,
      name: conta.nome,
      password: await hash(SENHA, 12),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  for (const slug of conta.papeis) {
    const role = await prisma.role.findUnique({ where: { slug } });
    if (!role) throw new Error(`Papel "${slug}" não existe. Rode o seed principal antes.`);
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });
  }

  return user.id;
}

/** Código de kit válido no módulo 11 e inédito na base. */
function gerarCodigoKit(): string {
  const corpo = String(randomBytes(3).readUIntBE(0, 3) % 1_000_000).padStart(6, '0');
  const dv = (digitos: string, peso: number): number => {
    const soma = [...digitos].reduce((acc, d, i) => acc + Number(d) * (peso - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = dv(corpo, 7);
  const d2 = dv(corpo + d1, 8);
  return `${corpo}-${d1}${d2}`;
}

async function codigoKitUnico(): Promise<string> {
  for (;;) {
    const code = gerarCodigoKit();
    if (!(await prisma.kit.findUnique({ where: { code } }))) return code;
  }
}

/**
 * Jornada de um paciente com laudo: titular (com `externalCode` para o CSV
 * casar), pedido concluído e kit ativado. Idempotente pelo número do pedido.
 */
async function semearPacienteComLaudo(
  userId: string,
  nome: string,
  code: string,
  orderNumber: string,
  batchId: string,
): Promise<string> {
  let subject = await prisma.subject.findFirst({ where: { externalCode: code } });
  subject ??= await prisma.subject.create({ data: { externalCode: code } });

  await prisma.subjectLink.upsert({
    where: { userId_subjectId: { userId, subjectId: subject.id } },
    update: {},
    create: { userId, subjectId: subject.id, relation: 'SELF' },
  });

  const jaTemPedido = await prisma.order.findUnique({ where: { number: orderNumber } });
  if (!jaTemPedido) {
    const diasAtras = (d: number): Date => new Date(Date.now() - d * 86_400_000);
    const order = await prisma.order.create({
      data: {
        number: orderNumber,
        userId,
        customerName: nome,
        customerEmail: (await prisma.user.findUnique({ where: { id: userId } }))!.email,
        customerDoc: '529.982.247-25',
        status: 'REPORT_READY',
        subtotalCents: PRODUTO.cents,
        totalCents: PRODUTO.cents,
        createdAt: diasAtras(45),
        paidAt: diasAtras(45),
        items: {
          create: { productSlug: PRODUTO.slug, productName: PRODUTO.nome, unitCents: PRODUTO.cents },
        },
        events: {
          create: (
            [
              ['PAID', 45],
              ['KIT_SHIPPED', 43],
              ['KIT_DELIVERED', 39],
              ['SAMPLE_IN_TRANSIT', 35],
              ['SAMPLE_RECEIVED', 30],
              ['PROCESSING', 25],
              ['REPORT_READY', 15],
            ] as const
          ).map(([status, dias]) => ({ status, actor: 'system', createdAt: diasAtras(dias) })),
        },
      },
    });

    await prisma.kit.create({
      data: {
        code: await codigoKitUnico(),
        batchId,
        status: 'ACTIVATED',
        orderId: order.id,
        subjectId: subject.id,
        activatedByUserId: userId,
        activatedAt: diasAtras(41),
      },
    });
  }

  return subject.id;
}

async function main(): Promise<void> {
  if (process.env.DEMO_SEED !== 'YES') {
    console.error(
      'Recusando rodar. Este seed cria contas com senha conhecida (12345678).\n' +
        'Para rodar de propósito: DEMO_SEED=YES npm run seed:demo',
    );
    process.exitCode = 1;
    return;
  }

  console.log('Semeando contas de demonstração…\n');

  const ids = new Map<string, string>();
  for (const conta of CONTAS) {
    ids.set(conta.email, await criarConta(conta));
    console.log(`✓ ${conta.email.padEnd(24)} ${conta.papeis.join(', ')}`);
  }

  // --- Perfil do treinador (profissional) ----------------------------------
  const treinadorUserId = ids.get('treinador@email.com')!;
  const perfil = await prisma.professionalProfile.upsert({
    where: { userId: treinadorUserId },
    update: { specialty: 'Personal Trainer' },
    create: { userId: treinadorUserId, specialty: 'Personal Trainer' },
  });
  console.log('\n✓ perfil profissional: Treinador Demo (Personal Trainer)');

  // --- Parceiro afiliado, com cupom próprio ---------------------------------
  const parceiroUserId = ids.get('parceiro@email.com')!;
  const parceiro = await prisma.partner.upsert({
    where: { userId: parceiroUserId },
    update: { active: true },
    create: {
      userId: parceiroUserId,
      type: 'INDIVIDUAL',
      displayName: 'Parceiro Demo',
      document: '390.533.447-05',
      channel: 'Instagram @parceirodemo',
      couponCode: 'DEMO10',
      active: true,
    },
  });
  await prisma.coupon.upsert({
    where: { code: 'DEMO10' },
    update: { active: true },
    create: {
      code: 'DEMO10',
      discountPercent: 10,
      commissionPercent: 20,
      partnerName: parceiro.displayName,
      active: true,
    },
  });
  console.log('✓ parceiro DEMO10 · 10% desconto · 20% comissão');

  // --- Lote de kits ativáveis, para testar a ativação -----------------------
  const lote = await prisma.kitBatch.upsert({
    where: { reference: 'DEMO' },
    update: {},
    create: { reference: 'DEMO', notes: 'Lote de demonstração' },
  });

  const ativaveis = await prisma.kit.count({ where: { batchId: lote.id, status: 'GENERATED' } });
  const codigos: string[] = [];
  for (let i = ativaveis; i < 5; i += 1) {
    const code = await codigoKitUnico();
    await prisma.kit.create({ data: { code, batchId: lote.id, status: 'GENERATED' } });
    codigos.push(code);
  }
  const amostraKits =
    codigos.length > 0
      ? codigos
      : (
          await prisma.kit.findMany({
            where: { batchId: lote.id, status: 'GENERATED' },
            take: 3,
            select: { code: true },
          })
        ).map((k) => k.code);
  console.log(`✓ kits ativáveis para teste: ${amostraKits.slice(0, 3).join(' · ')}`);

  // --- Pacientes com laudo + compartilhamento do paciente1 ------------------
  for (const p of PACIENTES_COM_LAUDO) {
    const userId = ids.get(p.email)!;
    const nome = CONTAS.find((c) => c.email === p.email)!.nome;
    const subjectId = await semearPacienteComLaudo(userId, nome, p.code, p.order, lote.id);

    if (p.shareComTreinador) {
      const jaCompartilha = await prisma.dataSharing.findFirst({
        where: { subjectId, professionalId: perfil.id, status: 'AUTHORIZED' },
      });
      if (!jaCompartilha) {
        await prisma.dataSharing.create({
          data: {
            subjectId,
            professionalId: perfil.id,
            status: 'AUTHORIZED',
            initiatedBy: 'PATIENT',
            authorizedAt: new Date(),
          },
        });
      }
    }
    console.log(
      `✓ ${p.email.padEnd(20)} titular ${p.code}` +
        (p.shareComTreinador ? ' · compartilhado com treinador' : ''),
    );
  }

  console.log(`\nSenha de todas as contas: ${SENHA}`);
  console.log('Laudos dos pacientes: suba prisma/seeds/data/demo-genotipos-performance.csv');
  console.log('no painel do laboratório (painel Performance) para publicá-los.');
  console.log('\n⚠️  Ambiente de homologação — nenhuma destas contas deve existir em produção real.');
}

main()
  .catch((error: unknown) => {
    console.error('Seed de demonstração falhou:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
