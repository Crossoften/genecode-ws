import type { PrismaClient } from '@prisma/client';

/**
 * Catálogo inicial.
 *
 * Preços e textos vêm do protótipo aprovado pelo cliente
 * (`GeneCode-Vitrine-v2.html`). A contagem de marcadores **não**: ali estava
 * 45/52/120+, e os painéis entregam 30/24/44.
 *
 * Optei por semear os números reais e deixar a divergência registrada aqui, em
 * vez de repetir o número da vitrine. Anunciar 45 marcadores e entregar 30 num
 * produto de saúde é risco de publicidade enganosa, e a decisão de corrigir a
 * peça ou expandir o painel é do cliente — mas o banco não deve carregar o
 * número que sabemos estar errado enquanto isso.
 *
 * Ver `docs/01-produto/04-decisoes.md`, item B1.
 */
interface ProductSeed {
  readonly slug: string;
  readonly name: string;
  readonly summary: string;
  readonly description: string;
  readonly panelSlug: string | null;
  readonly markerCount: number;
  readonly priceCents: number;
  readonly position: number;
  readonly highlight?: string;
  readonly features: readonly string[];
  readonly traits: Readonly<Record<string, number>>;
}

const PRODUCTS: readonly ProductSeed[] = [
  {
    slug: 'nutrigenetica',
    name: 'GeneCode Nutrigenética',
    summary: 'Como seu corpo responde a nutrientes, dietas e sensibilidades alimentares.',
    description:
      'Analisa como o seu organismo processa carboidratos, gorduras, vitaminas e cafeína, ' +
      'além de sensibilidades como lactose e glúten. Ideal para quem quer ajustar a ' +
      'alimentação com base no próprio DNA.',
    panelSlug: 'nutrigenetics',
    // Protótipo anunciava 45. O painel semeado tem 30 (26 simples + 4 pendentes
    // de lógica combinada em MTHFR e HFE).
    markerCount: 30,
    priceCents: 39_700,
    position: 0,
    features: [
      'Kit de coleta com swab bucal',
      'Envelope de retorno para envio ao laboratório',
      'Laudo interativo com referências científicas',
      'Teleorientação de 15 minutos com nutricionista',
    ],
    traits: { nutrition: 100, performance: 20, health: 40 },
  },
  {
    slug: 'performance',
    name: 'GeneCode Performance',
    summary: 'Força, recuperação, resposta ao treino e predisposição a lesões.',
    description:
      'Mapeia seu perfil de força e resistência, capacidade de recuperação, resposta ao ' +
      'treino e predisposição a lesões, com índice de aderência para 30 modalidades ' +
      'esportivas. Para quem treina e quer evoluir com inteligência.',
    panelSlug: 'performance',
    // Protótipo anunciava 52. O painel tem 24.
    markerCount: 24,
    priceCents: 46_800,
    position: 1,
    features: [
      'Kit de coleta com swab bucal',
      'Envelope de retorno para envio ao laboratório',
      'Índice de aderência para 30 modalidades esportivas',
      'Laudo interativo com referências científicas',
      'Teleorientação de 15 minutos com profissional',
    ],
    traits: { nutrition: 20, performance: 100, health: 40 },
  },
  {
    slug: 'premium',
    name: 'GeneCode Premium',
    summary: 'A análise completa: nutrigenética e performance num só exame.',
    description:
      'Une os painéis de nutrigenética e performance num único exame, cobrindo desde o ' +
      'metabolismo de nutrientes até a resposta ao treino e o risco de lesão.',
    // Composição dos dois painéis, conforme a decisão B1. Ainda não existe um
    // painel único no banco, então fica nulo.
    panelSlug: null,
    // Protótipo anunciava 120+. A união real dos dois painéis são 44 marcadores
    // únicos: eles compartilham 10.
    markerCount: 44,
    priceCents: 69_000,
    highlight: 'Mais vendido',
    position: 2,
    features: [
      'Tudo dos painéis Nutrigenética e Performance',
      'Kit de coleta com swab bucal',
      'Envelope de retorno para envio ao laboratório',
      'Laudo interativo com referências científicas',
      'Teleorientação de 15 minutos com médico ou nutricionista',
      'Atualizações futuras do laudo incluídas',
    ],
    traits: { nutrition: 85, performance: 85, health: 100 },
  },
];

/**
 * Semeia o catálogo.
 *
 * Idempotente por slug. Features e traits são reescritos a cada execução para
 * que remover um item deste arquivo realmente o remova do banco.
 */
export async function seedCatalog(prisma: PrismaClient): Promise<void> {
  for (const product of PRODUCTS) {
    const record = await prisma.product.upsert({
      where: { slug: product.slug },
      update: {
        name: product.name,
        summary: product.summary,
        description: product.description,
        panelSlug: product.panelSlug,
        markerCount: product.markerCount,
        priceCents: product.priceCents,
        highlight: product.highlight ?? null,
        position: product.position,
        published: true,
      },
      create: {
        slug: product.slug,
        name: product.name,
        summary: product.summary,
        description: product.description,
        panelSlug: product.panelSlug,
        markerCount: product.markerCount,
        priceCents: product.priceCents,
        highlight: product.highlight ?? null,
        position: product.position,
        published: true,
      },
    });

    await prisma.productFeature.deleteMany({ where: { productId: record.id } });
    await prisma.productFeature.createMany({
      data: product.features.map((label, position) => ({
        productId: record.id,
        label,
        position,
      })),
    });

    await prisma.productTrait.deleteMany({ where: { productId: record.id } });
    await prisma.productTrait.createMany({
      data: Object.entries(product.traits).map(([trait, weight]) => ({
        productId: record.id,
        trait,
        weight,
      })),
    });
  }

  console.log(`✓ catálogo: ${PRODUCTS.length} produtos`);
  console.warn(
    '  ⚠️  marcadores semeados com a contagem REAL (30/24/44). ' +
      'A vitrine aprovada anuncia 45/52/120+ — ver decisão B1.',
  );
}
