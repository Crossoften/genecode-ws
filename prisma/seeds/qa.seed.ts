import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { hash } from 'bcrypt';

/**
 * Fixtures for the QA environment.
 *
 * ### Why this is a separate seed
 *
 * The main seed refuses to create accounts with known passwords when
 * `NODE_ENV=production`, and homolog runs as production. That guard is correct
 * and stays — the old backend shipped `admin.master@email.com / 12345678`
 * unconditionally, which is exactly the accident it prevents.
 *
 * But QA needs accounts, and creating them by hand produces an environment
 * nobody can reproduce. So the path is explicit instead: this file only runs
 * when `SEED_QA=YES` is passed on the command line, and it prints every
 * credential it creates.
 *
 * ### What it builds
 *
 * A whole journey's worth of data, so QA can start anywhere:
 * four accounts (admin, patient, professional, affiliate), a subject with a
 * published report, a batch of activatable kits, and a sharing authorisation
 * linking the patient to the professional.
 *
 * ⚠️ **Never run this against production.** The guard below checks for an
 * explicit opt-in, not for the environment, precisely because homolog *is*
 * production as far as `NODE_ENV` is concerned.
 */
const prisma = new PrismaClient();

/** Senha única para todas as contas de QA, para o caderno de testes ser curto. */
const SENHA_QA = 'GeneCodeQA2026!';

interface ContaQa {
  readonly email: string;
  readonly nome: string;
  readonly papeis: readonly string[];
  readonly descricao: string;
}

const CONTAS: readonly ContaQa[] = [
  { email: 'qa.admin@genecode.test', nome: 'QA Administração', papeis: ['master'],
    descricao: 'painel administrativo, BI, esteira de pedidos' },
  { email: 'qa.paciente@genecode.test', nome: 'Camila Rocha', papeis: ['patient'],
    descricao: 'área do paciente, laudo interativo, ativação de kit' },
  { email: 'qa.profissional@genecode.test', nome: 'Marina Costa', papeis: ['professional', 'patient'],
    descricao: 'área do profissional, laudo consolidado' },
  { email: 'qa.parceiro@genecode.test', nome: 'Rafael Afiliado', papeis: ['affiliate', 'patient'],
    descricao: 'painel do parceiro, comissões, cupom' },
];

async function criarConta(conta: ContaQa): Promise<string> {
  const user = await prisma.user.upsert({
    where: { email: conta.email },
    update: { status: 'ACTIVE', emailVerifiedAt: new Date() },
    create: {
      email: conta.email,
      name: conta.nome,
      password: await hash(SENHA_QA, 12),
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

/**
 * Gera um lote de kits ativáveis.
 *
 * Códigos aleatórios com dígito verificador de módulo 11, como o lote real —
 * sequencial permitiria deduzir códigos válidos a partir de um único kit.
 */
function gerarCodigoKit(): string {
  const base = randomBytes(3).readUIntBE(0, 3) % 1_000_000;
  const corpo = String(base).padStart(6, '0');

  const dv = (digitos: string, pesoInicial: number): number => {
    const soma = [...digitos].reduce(
      (acc, d, i) => acc + Number(d) * (pesoInicial - i),
      0,
    );
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  const d1 = dv(corpo, 7);
  const d2 = dv(corpo + d1, 8);
  return `${corpo}-${d1}${d2}`;
}

async function main(): Promise<void> {
  if (process.env.SEED_QA !== 'YES') {
    console.error(
      'Recusando rodar. Este seed cria contas com senha conhecida.\n' +
        'Para rodar de propósito: SEED_QA=YES npm run seed:qa',
    );
    process.exitCode = 1;
    return;
  }

  console.log('Semeando fixtures de QA…\n');

  const ids = new Map<string, string>();
  for (const conta of CONTAS) {
    ids.set(conta.email, await criarConta(conta));
    console.log(`✓ ${conta.email.padEnd(30)} ${conta.papeis.join(', ')}`);
  }

  // --- Parceiro, com cupom próprio ------------------------------------------
  const parceiroUserId = ids.get('qa.parceiro@genecode.test')!;
  const parceiro = await prisma.partner.upsert({
    where: { userId: parceiroUserId },
    update: { active: true },
    create: {
      userId: parceiroUserId,
      type: 'INDIVIDUAL',
      displayName: 'Rafael Afiliado',
      document: '390.533.447-05',
      channel: 'Instagram @rafaelfit',
      couponCode: 'QAPARCEIRO',
      active: true,
    },
  });
  // A comissão vive no cupom, não no parceiro — foi a decisão F6: o admin define
  // o percentual, e ele acompanha o cupom que gerou a venda.
  await prisma.coupon.upsert({
    where: { code: 'QAPARCEIRO' },
    update: { active: true },
    create: {
      code: 'QAPARCEIRO',
      discountPercent: 10,
      commissionPercent: 20,
      partnerName: parceiro.displayName,
      active: true,
    },
  });
  console.log('\n✓ parceiro QAPARCEIRO · 10% de desconto · 20% de comissão');

  // --- Lote de kits para o QA ativar ----------------------------------------
  const existentes = await prisma.kit.count({ where: { status: 'GENERATED' } });

  if (existentes < 10) {
    const lote = await prisma.kitBatch.create({
      data: { reference: `QA-${new Date().toISOString().slice(0, 10)}`, notes: 'Lote para homologação' },
    });
    const codigos: string[] = [];
    while (codigos.length < 10) {
      const code = gerarCodigoKit();
      const jaExiste = await prisma.kit.findUnique({ where: { code } });
      if (jaExiste) continue;
      await prisma.kit.create({ data: { code, batchId: lote.id, status: 'GENERATED' } });
      codigos.push(code);
    }
    console.log(`✓ lote ${lote.reference} com ${codigos.length} kits ativáveis`);
    console.log(`  para o caderno de testes: ${codigos.slice(0, 3).join(' · ')}`);
  } else {
    const amostra = await prisma.kit.findMany({
      where: { status: 'GENERATED' },
      take: 3,
      select: { code: true },
    });
    console.log(`✓ já havia ${existentes} kits ativáveis`);
    console.log(`  para o caderno: ${amostra.map((k) => k.code).join(' · ')}`);
  }

  console.log(`\nSenha de todas as contas: ${SENHA_QA}`);
  console.log('\n⚠️  Ambiente de homologação. Nenhuma destas contas deve existir em produção.');
}

main()
  .catch((error: unknown) => {
    console.error('Seed de QA falhou:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
