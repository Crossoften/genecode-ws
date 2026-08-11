import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { ConflictError, ValidationError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

import { slugFromName } from '../../domain/product-slug';
import { toAdminProductView, type AdminProductView } from '../admin-product.view';

export interface CreateProductInput {
  readonly name: string;
  readonly slug?: string;
  readonly summary: string;
  readonly description: string;
  readonly features?: readonly string[];
  readonly markerCount?: number;
  readonly priceCents: number;
  readonly promoPriceCents?: number;
  readonly maxInstallments?: number;
  readonly highlight?: string;
  readonly imageUrl?: string;
  readonly weightGrams?: number;
  readonly dimensionsCm?: string;
  readonly category?: string;
}

/**
 * Creates a storefront product from the admin form (tela adm-8).
 *
 * Every new product starts unpublished — publishing is an intentional separate
 * step, done through the state endpoint. The slug is derived from the name
 * when the form does not provide one.
 */
@Injectable()
export class AdminCreateProductUseCase {
  constructor(private readonly prisma: PrismaService) {}

  /** Persists the product with its feature list, always unpublished. */
  async execute(input: CreateProductInput): Promise<Result<AdminProductView>> {
    const slug = input.slug ?? slugFromName(input.name);
    if (!slug) {
      return fail(new ValidationError('Não foi possível derivar um slug a partir do nome.'));
    }

    const existing = await this.prisma.product.findUnique({ where: { slug } });
    if (existing) return fail(new ConflictError('Já existe um produto com este slug.', { slug }));

    // Produto novo entra no fim da vitrine, não na frente dos existentes.
    const last = await this.prisma.product.aggregate({ _max: { position: true } });

    const product = await this.prisma.product.create({
      data: {
        slug,
        name: input.name,
        summary: input.summary,
        description: input.description,
        markerCount: input.markerCount ?? 0,
        priceCents: input.priceCents,
        promoPriceCents: input.promoPriceCents ?? null,
        maxInstallments: input.maxInstallments ?? 12,
        published: false,
        archived: false,
        highlight: input.highlight ?? null,
        position: (last._max.position ?? -1) + 1,
        imageUrl: input.imageUrl ?? null,
        weightGrams: input.weightGrams ?? null,
        dimensionsCm: input.dimensionsCm ?? null,
        category: input.category ?? null,
        features: {
          create: (input.features ?? []).map((label, index) => ({ label, position: index })),
        },
      },
      include: { features: { orderBy: { position: 'asc' } } },
    });

    return ok(toAdminProductView(product));
  }
}
