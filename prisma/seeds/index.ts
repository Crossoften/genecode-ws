import { PrismaClient } from '@prisma/client';
import { hash } from 'bcrypt';

const prisma = new PrismaClient();

/**
 * Permission catalogue.
 *
 * Data, not a Prisma enum. The old schema had exactly two permissions as enum
 * values, which meant adding one required a schema migration — unworkable for an
 * admin area that needs granular control over orders, kits, samples, lab,
 * reports, products, payments, partners and audit.
 */
const PERMISSIONS = [
  ['users.read', 'Visualizar usuários'],
  ['users.write', 'Gerenciar usuários'],
  ['orders.read', 'Visualizar pedidos'],
  ['orders.write', 'Gerenciar pedidos'],
  ['products.read', 'Visualizar produtos'],
  ['products.write', 'Gerenciar produtos'],
  ['kits.read', 'Visualizar kits'],
  ['kits.write', 'Gerenciar kits e códigos de ativação'],
  ['samples.read', 'Visualizar amostras'],
  ['samples.write', 'Gerenciar esteira de amostras'],
  ['lab.upload', 'Enviar CSV de genótipos'],
  ['reports.read', 'Visualizar laudos'],
  ['reports.publish', 'Publicar laudos'],
  ['partners.read', 'Visualizar parceiros'],
  ['partners.write', 'Gerenciar parceiros e comissões'],
  ['finance.read', 'Visualizar financeiro'],
  ['analytics.read', 'Visualizar BI'],
  ['audit.read', 'Consultar trilha de auditoria'],
] as const;

/** Roles and the permissions each one carries. */
const ROLES: ReadonlyArray<{
  slug: string;
  name: string;
  description: string;
  permissions: readonly string[];
}> = [
  {
    slug: 'patient',
    name: 'Paciente',
    description: 'Cliente final: compra o kit, ativa a amostra e acessa o próprio laudo.',
    permissions: [],
  },
  {
    slug: 'professional',
    name: 'Parceiro Profissional',
    description:
      'Personal trainer, nutricionista ou médico. Vê o laudo consolidado de quem autorizou.',
    permissions: [],
  },
  {
    slug: 'affiliate',
    name: 'Parceiro Afiliado',
    description: 'Vende por cupom e acompanha comissões. Nunca acessa laudo.',
    permissions: [],
  },
  {
    slug: 'lab',
    name: 'Laboratório',
    description: 'Envia os genótipos e opera a esteira interna de amostras.',
    permissions: ['lab.upload', 'samples.read', 'samples.write', 'reports.read'],
  },
  {
    slug: 'admin',
    name: 'Administrador',
    description: 'Operação da plataforma.',
    permissions: PERMISSIONS.map(([slug]) => slug).filter((slug) => slug !== 'audit.read'),
  },
  {
    slug: 'master',
    name: 'Master',
    description: 'Acesso total, incluindo a trilha de auditoria.',
    permissions: PERMISSIONS.map(([slug]) => slug),
  },
];

/**
 * Seeds roles, permissions and a development admin.
 *
 * Idempotent throughout — the previous seed used bare `create` calls and blew up
 * with a unique-constraint error on the second run.
 */
async function main(): Promise<void> {
  for (const [slug, name] of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { slug },
      update: { name },
      create: { slug, name },
    });
  }
  console.log(`✓ ${PERMISSIONS.length} permissões`);

  for (const role of ROLES) {
    const record = await prisma.role.upsert({
      where: { slug: role.slug },
      update: { name: role.name, description: role.description },
      create: { slug: role.slug, name: role.name, description: role.description },
    });

    // Rewrite the role's grants so removing a permission from this file actually
    // revokes it, instead of leaving an orphan grant behind.
    await prisma.rolePermission.deleteMany({ where: { roleId: record.id } });

    if (role.permissions.length > 0) {
      const permissions = await prisma.permission.findMany({
        where: { slug: { in: [...role.permissions] } },
        select: { id: true },
      });
      await prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: record.id, permissionId: p.id })),
      });
    }
  }
  console.log(`✓ ${ROLES.length} papéis`);

  await seedDevelopmentAdmin();
}

/**
 * Creates a local admin account.
 *
 * Guarded by NODE_ENV: a known password must never exist in production. The old
 * seed created `admin.master@email.com` with the password `12345678`
 * unconditionally.
 */
async function seedDevelopmentAdmin(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.log('· ambiente de produção — admin de desenvolvimento não criado');
    return;
  }

  const email = 'admin@genecode.local';
  const password = 'Genecode123';

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: 'Admin GeneCode',
      password: await hash(password, 12),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  const master = await prisma.role.findUniqueOrThrow({ where: { slug: 'master' } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: master.id } },
    update: {},
    create: { userId: user.id, roleId: master.id },
  });

  console.log(`✓ admin de desenvolvimento: ${email} / ${password}`);
}

main()
  .catch((error: unknown) => {
    console.error('Seed falhou:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
