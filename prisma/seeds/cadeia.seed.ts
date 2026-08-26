import { PrismaClient } from '@prisma/client';
import { hash } from 'bcrypt';

/**
 * Fixtures de "cadeia de testes" — 6 usuários NOMEADOS para o walkthrough visual
 * de QA (prints tela a tela, para caçar bug antes de mandar ao cliente).
 *
 * Idempotente e aditivo (upsert por e-mail). Não cria laudo: os titulares nascem
 * com `externalCode` CADEIA-01/02 e o laudo é gerado no passo do laboratório
 * (upload do CSV). Opt-in por `CADEIA_SEED=YES`.
 */
const prisma = new PrismaClient();
const SENHA = '12345678';

const CONTAS = [
  { email: 'helena.prado@teste.com', nome: 'Helena Prado', papeis: ['admin'] },
  { email: 'marcos.vieira@teste.com', nome: 'Marcos Vieira', papeis: ['lab'] },
  { email: 'bianca.rocha@teste.com', nome: 'Bianca Rocha', papeis: ['professional'] },
  { email: 'rafael.nunes@teste.com', nome: 'Rafael Nunes', papeis: ['affiliate'] },
  { email: 'camila.torres@teste.com', nome: 'Camila Torres', papeis: ['patient'] },
  { email: 'diego.martins@teste.com', nome: 'Diego Martins', papeis: ['patient'] },
] as const;

const PACIENTES = [
  { email: 'camila.torres@teste.com', nome: 'Camila Torres', code: 'CADEIA-01', order: 'GC-CAD-0001', share: true },
  { email: 'diego.martins@teste.com', nome: 'Diego Martins', code: 'CADEIA-02', order: 'GC-CAD-0002', share: false },
] as const;

const PRODUTO = { slug: 'performance', nome: 'GeneCode Performance', cents: 46_800 } as const;

function codigoKit(): string {
  const corpo = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
  const dv = (d: string, w: number) => { const s = [...d].reduce((a, x, i) => a + Number(x) * (w - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(corpo, 7); const d2 = dv(corpo + d1, 8);
  return `${corpo}-${d1}${d2}`;
}
async function kitUnico(): Promise<string> { for (;;) { const c = codigoKit(); if (!(await prisma.kit.findUnique({ where: { code: c } }))) return c; } }

async function main(): Promise<void> {
  if (process.env.CADEIA_SEED !== 'YES') { console.error('Use CADEIA_SEED=YES'); process.exitCode = 1; return; }
  console.log('Semeando cadeia de testes (6 usuários nomeados)…\n');

  const ids = new Map<string, string>();
  for (const c of CONTAS) {
    const user = await prisma.user.upsert({
      where: { email: c.email },
      update: { status: 'ACTIVE', emailVerifiedAt: new Date() },
      create: { email: c.email, name: c.nome, password: await hash(SENHA, 12), status: 'ACTIVE', emailVerifiedAt: new Date() },
    });
    for (const slug of c.papeis) {
      const role = await prisma.role.findUnique({ where: { slug } });
      if (!role) throw new Error(`Papel ${slug} não existe`);
      await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, update: {}, create: { userId: user.id, roleId: role.id } });
    }
    ids.set(c.email, user.id);
    console.log(`✓ ${c.email.padEnd(26)} ${c.nome} · ${c.papeis.join(',')}`);
  }

  const perfil = await prisma.professionalProfile.upsert({
    where: { userId: ids.get('bianca.rocha@teste.com')! },
    update: { specialty: 'Personal Trainer' },
    create: { userId: ids.get('bianca.rocha@teste.com')!, specialty: 'Personal Trainer' },
  });

  const parceiroId = ids.get('rafael.nunes@teste.com')!;
  const parceiro = await prisma.partner.upsert({
    where: { userId: parceiroId }, update: { active: true },
    create: { userId: parceiroId, type: 'INDIVIDUAL', displayName: 'Rafael Nunes', document: '111.444.777-35', channel: 'Instagram @rafaeltreina', couponCode: 'RAFA10', active: true },
  });
  await prisma.coupon.upsert({ where: { code: 'RAFA10' }, update: { active: true }, create: { code: 'RAFA10', discountPercent: 10, commissionPercent: 20, partnerName: parceiro.displayName, active: true } });

  const lote = await prisma.kitBatch.upsert({ where: { reference: 'CADEIA' }, update: {}, create: { reference: 'CADEIA', notes: 'Lote da cadeia de testes' } });

  for (const p of PACIENTES) {
    const userId = ids.get(p.email)!;
    let subject = await prisma.subject.findFirst({ where: { externalCode: p.code } });
    subject ??= await prisma.subject.create({ data: { externalCode: p.code } });
    await prisma.subjectLink.upsert({ where: { userId_subjectId: { userId, subjectId: subject.id } }, update: {}, create: { userId, subjectId: subject.id, relation: 'SELF' } });

    if (!(await prisma.order.findUnique({ where: { number: p.order } }))) {
      const dias = (d: number) => new Date(Date.now() - d * 86_400_000);
      const order = await prisma.order.create({
        data: {
          number: p.order, userId, customerName: p.nome, customerEmail: p.email, customerDoc: '529.982.247-25',
          status: 'REPORT_READY', subtotalCents: PRODUTO.cents, totalCents: PRODUTO.cents, createdAt: dias(30), paidAt: dias(30),
          items: { create: { productSlug: PRODUTO.slug, productName: PRODUTO.nome, unitCents: PRODUTO.cents } },
          events: { create: ([['PAID',30],['KIT_SHIPPED',28],['KIT_DELIVERED',24],['SAMPLE_IN_TRANSIT',20],['SAMPLE_RECEIVED',15],['PROCESSING',10],['REPORT_READY',4]] as const).map(([status,d]) => ({ status, actor: 'system', createdAt: dias(d) })) },
        },
      });
      await prisma.kit.create({ data: { code: await kitUnico(), batchId: lote.id, status: 'ACTIVATED', orderId: order.id, subjectId: subject.id, activatedByUserId: userId, activatedAt: dias(26) } });
    }

    if (p.share) {
      const ja = await prisma.dataSharing.findFirst({ where: { subjectId: subject.id, professionalId: perfil.id, status: 'AUTHORIZED' } });
      if (!ja) await prisma.dataSharing.create({ data: { subjectId: subject.id, professionalId: perfil.id, status: 'AUTHORIZED', initiatedBy: 'PATIENT', authorizedAt: new Date() } });
    }
    console.log(`✓ paciente ${p.nome} · titular ${p.code}${p.share ? ' · compartilhado com Bianca' : ''}`);
  }

  console.log(`\nSenha de todas: ${SENHA}`);
  console.log('Laudos: subir CADEIA-01/02 no laboratório (painel Performance).');
}
main().catch((e) => { console.error('cadeia seed falhou:', e); process.exitCode = 1; }).finally(() => void prisma.$disconnect());
