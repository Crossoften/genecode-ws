import type { Prisma } from '@prisma/client';

type ProductWithFeatures = Prisma.ProductGetPayload<{ include: { features: true } }>;

export interface AdminProductView {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly summary: string;
  readonly description: string;
  readonly markerCount: number;
  readonly priceCents: number;
  readonly promoPriceCents: number | null;
  readonly maxInstallments: number;
  readonly published: boolean;
  readonly archived: boolean;
  readonly highlight: string | null;
  readonly position: number;
  readonly imageUrl: string | null;
  readonly weightGrams: number | null;
  readonly dimensionsCm: string | null;
  readonly category: string | null;
  readonly features: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Maps the Prisma entity to the shape the admin screens consume (adm-7/adm-8). */
export function toAdminProductView(product: ProductWithFeatures): AdminProductView {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    summary: product.summary,
    description: product.description,
    markerCount: product.markerCount,
    priceCents: product.priceCents,
    promoPriceCents: product.promoPriceCents,
    maxInstallments: product.maxInstallments,
    published: product.published,
    archived: product.archived,
    highlight: product.highlight,
    position: product.position,
    imageUrl: product.imageUrl,
    weightGrams: product.weightGrams,
    dimensionsCm: product.dimensionsCm,
    category: product.category,
    features: [...product.features]
      .sort((a, b) => a.position - b.position)
      .map((feature) => feature.label),
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}
