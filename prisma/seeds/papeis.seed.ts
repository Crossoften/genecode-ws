import type { PrismaClient } from '@prisma/client';

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
  ['notifications.read', 'Visualizar gatilhos de notificação'],
  ['notifications.write', 'Gerenciar gatilhos de notificação'],
  ['finance.read', 'Visualizar financeiro'],
  ['analytics.read', 'Visualizar BI'],
  ['audit.read', 'Consultar trilha de auditoria'],
  ['questionnaire.read', 'Visualizar questionário ambiental'],
  ['questionnaire.write', 'Editar perguntas e pesos do questionário ambiental'],
  ['team.read', 'Visualizar a equipe interna'],
  ['team.write', 'Convidar colaboradores e definir o acesso de cada um'],
] as const;

/**
 * Roles and the permissions each one carries.
 *
 * `professional` and `affiliate` carry NO permissions on purpose. Their routes
 * are guarded by `@RequireRoles` plus per-record checks in the use cases
 * (`DataSharing` for the consolidated report, `Partner.userId` for the panel) —
 * and both roles are self-assigned on sign-up, so any permission granted here
 * is effectively public to every logged-in account. In particular, `reports.*`
 * must never appear on either: the professional would gain the genotype routes
 * the client forbade, and the affiliate must never reach a report at all.
 */
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
    // reports.read abre as rotas do laudo; o escopo de QUAL laudo é o
    // SubjectLink, verificado no GetReportUseCase — não conceder nada além.
    permissions: ['reports.read'],
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
    permissions: [
      'lab.upload',
      'samples.read',
      'samples.write',
      'reports.read',
      'questionnaire.read',
      'questionnaire.write',
    ],
  },
  /**
   * Os dois papéis parciais, pedidos na call de 09/10.
   *
   * O Augusto levantou o caso: *"você não vai dar pro cara de laboratório
   * acesso ao financeiro. Esse cara não precisa ter; ele vai ter um acesso
   * parcial com o que diz respeito a laboratório"*. O André nomeou os outros
   * dois: *"colocar lá um gestor financeiro… ou colocar o gestor de pedidos"*.
   *
   * Cada um carrega só o que a sua aba precisa — e, por tabela, o menu do
   * admin mostra só as abas que a permissão abre.
   */
  {
    slug: 'finance',
    name: 'Gestor financeiro',
    description: 'Vê receita, comissões e repasses. Não mexe na esteira nem no catálogo.',
    permissions: ['finance.read', 'analytics.read', 'orders.read', 'partners.read'],
  },
  {
    slug: 'orders',
    name: 'Gestor de pedidos',
    description: 'Toca a esteira do pedido até a entrega. Não vê financeiro.',
    permissions: ['orders.read', 'orders.write', 'samples.read', 'analytics.read'],
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
 * Papéis e permissões da plataforma.
 *
 * Mora num arquivo próprio, e com runner próprio (`npm run seed:papeis`), por
 * um motivo prático de deploy: o seed completo **sobrescreve o catálogo de
 * produtos** e zera `promoPriceCents` (ver `catalog.seed.ts`). Em homologação,
 * onde o cliente edita preço e promoção pela tela, rodar o seed inteiro só
 * para publicar um papel novo apagaria o trabalho dele.
 *
 * Foi o que a onda de 09/10 exigiu: os papéis parciais (gestor financeiro e
 * gestor de pedidos) e as permissões de equipe precisam existir no banco para
 * a tela de equipe funcionar, e precisam entrar sem tocar em mais nada.
 */
export async function seedPapeis(prisma: PrismaClient): Promise<void> {
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

}
