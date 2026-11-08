import { PrismaClient } from '@prisma/client';
import { hash } from 'bcrypt';

/**
 * Conta de homolog com treinador **e** parceiro (GC-N05-T4).
 *
 * Na reunião de 05/11 (00:55:30) o cliente pediu uma conta que tenha os dois
 * papéis para testar o seletor de perfis. A `treinador@email.com` do seed de
 * demonstração já carrega os dois, mas o cliente usa essa conta no dia a dia
 * como "o treinador" — esta é dedicada ao seletor, com nome que diz o que é.
 *
 * ### Mesmo contrato do `demo.seed.ts`
 *
 * - **Opt-in explícito:** só roda com `DEMO_SEED=YES`. O homolog roda como
 *   `NODE_ENV=production`, então a trava não pode ser o `NODE_ENV`.
 * - **Idempotente e aditivo:** `upsert` por e-mail, cupom e perfil; rodar duas
 *   vezes não duplica nada e não apaga nada. A senha só é gravada na criação —
 *   se alguém trocou a senha pela tela, rodar de novo não a desfaz.
 * - **Depende dos papéis:** `professional` e `affiliate` precisam existir
 *   (`npm run seed:papeis`).
 *
 * ⚠️ Nunca rode contra produção.
 */
const prisma = new PrismaClient();

const EMAIL = 'treinadorparceiro@email.com';
const SENHA = '12345678';
const NOME = 'Treinador Parceiro';
/** CPF sintético válido, que nenhum outro seed usa. */
const CPF = '71460238001';
const CPF_FORMATADO = '714.602.380-01';
/** Cupom próprio. Para parceiro, cupom é identificador: desconto zero (03/10). */
const CUPOM = 'TREINOPARC';

async function main(): Promise<void> {
  if (process.env.DEMO_SEED !== 'YES') {
    console.error(
      'Recusando rodar. Este seed cria conta com senha conhecida (12345678).\n' +
        'Para rodar de propósito: DEMO_SEED=YES npm run seed:treinador-parceiro',
    );
    process.exitCode = 1;
    return;
  }

  // CPF na conta só se ninguém mais o usa: `users.document` é único, e o
  // seletor não depende dele. O parceiro guarda o documento de qualquer jeito.
  const cpfOcupado = await prisma.user.findFirst({
    where: { document: { in: [CPF, CPF_FORMATADO] }, NOT: { email: EMAIL } },
    select: { id: true },
  });

  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { status: 'ACTIVE', emailVerifiedAt: new Date() },
    create: {
      email: EMAIL,
      name: NOME,
      password: await hash(SENHA, 12),
      document: cpfOcupado ? null : CPF,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  for (const slug of ['professional', 'affiliate']) {
    const role = await prisma.role.findUnique({ where: { slug } });
    if (!role) throw new Error(`Papel "${slug}" não existe. Rode "npm run seed:papeis" antes.`);
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });
  }

  // Perfil curado de treinador (card #526): nasce aprovado.
  await prisma.professionalProfile.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      specialty: 'Personal Trainer',
      status: 'APPROVED',
      approvedAt: new Date(),
    },
  });

  // Parceiro raiz de rede, com o bolo inteiro — igual a quem é aprovado pelo
  // "Quero ser parceiro" sem convite.
  await prisma.coupon.upsert({
    where: { code: CUPOM },
    update: { active: true },
    create: {
      code: CUPOM,
      discountPercent: 0,
      commissionPercent: 20,
      partnerName: NOME,
      active: true,
    },
  });
  await prisma.partner.upsert({
    where: { userId: user.id },
    update: { active: true },
    create: {
      userId: user.id,
      type: 'INDIVIDUAL',
      displayName: NOME,
      document: CPF_FORMATADO,
      channel: 'Conta de homolog para testar o seletor de perfis',
      couponCode: CUPOM,
      active: true,
    },
  });

  console.log(`✓ ${EMAIL} · treinador + parceiro · cupom ${CUPOM}`);
  console.log(`  Senha: ${SENHA} (só na criação; não sobrescreve senha trocada)`);
  console.log('  Login de parceiro pede o código por e-mail (2ª etapa).');
  console.log('\n⚠️  Ambiente de homologação — esta conta não deve existir em produção.');
}

main()
  .catch((erro: unknown) => {
    console.error('Seed treinador+parceiro falhou:', erro);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
