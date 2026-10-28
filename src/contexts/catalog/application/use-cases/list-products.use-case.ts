import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';

export interface ProductView {
  readonly slug: string;
  readonly name: string;
  readonly summary: string;
  readonly description: string;
  readonly markerCount: number;
  readonly priceCents: number;
  readonly promoPriceCents: number | null;
  readonly maxInstallments: number;
  readonly highlight: string | null;
  readonly imageUrl: string | null;
  /** Galeria da página do produto, na ordem (GC-AJ-032). */
  readonly images: readonly { readonly url: string; readonly alt: string | null }[];
  readonly features: readonly string[];
}

/**
 * Lê o catálogo público.
 *
 * Só devolve produto publicado e não arquivado. Arquivar tira da vitrine sem
 * apagar do banco — há clientes que compraram, e o histórico do pedido precisa
 * continuar íntegro.
 */
@Injectable()
export class ListProductsUseCase {
  constructor(private readonly prisma: PrismaService) {}

  /** Produtos visíveis na vitrine, na ordem definida pelo admin. */
  async execute(): Promise<ProductView[]> {
    const products = await this.prisma.product.findMany({
      where: { published: true, archived: false },
      orderBy: { position: 'asc' },
      include: {
        features: { orderBy: { position: 'asc' } },
        images: { orderBy: { position: 'asc' } },
      },
    });

    return products.map((product) => ({
      slug: product.slug,
      name: product.name,
      summary: product.summary,
      description: product.description,
      markerCount: product.markerCount,
      priceCents: product.priceCents,
      promoPriceCents: product.promoPriceCents,
      maxInstallments: product.maxInstallments,
      highlight: product.highlight,
      imageUrl: product.imageUrl,
      images: product.images.map((image) => ({ url: image.url, alt: image.alt })),
      features: product.features.map((feature) => feature.label),
    }));
  }
}
