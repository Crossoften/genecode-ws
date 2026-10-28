import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

import {
  ADMIN_PRODUCT_INCLUDE,
  toAdminProductView,
  type AdminProductView,
} from '../admin-product.view';
import type { CreateProductInput } from './admin-create-product.use-case';

export type UpdateProductInput = Omit<CreateProductInput, 'slug'>;

/**
 * Updates a product from the admin form and replaces its feature list
 * (tela adm-8, modo editar).
 *
 * The slug is immutable: it keys the public URL and the frozen order items.
 * Publication state is not touched here — that goes through the state
 * endpoint.
 */
@Injectable()
export class AdminUpdateProductUseCase {
  constructor(private readonly prisma: PrismaService) {}

  /** Applies the form fields and recreates the features by position. */
  async execute(slug: string, input: UpdateProductInput): Promise<Result<AdminProductView>> {
    const product = await this.prisma.product.findUnique({ where: { slug } });
    if (!product) return fail(new NotFoundError('Produto não encontrado.'));

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.productFeature.deleteMany({ where: { productId: product.id } });

      // Galeria (GC-AJ-032): a lista que veio é a galeria inteira, na ordem.
      // O texto alternativo de uma foto que continua é preservado.
      if (input.images !== undefined) {
        const before = await tx.productImage.findMany({ where: { productId: product.id } });
        const altByUrl = new Map(before.map((image) => [image.url, image.alt]));
        await tx.productImage.deleteMany({ where: { productId: product.id } });
        await tx.productImage.createMany({
          data: input.images.map((url, position) => ({
            productId: product.id,
            url,
            alt: altByUrl.get(url) ?? null,
            position,
          })),
        });
      }

      return tx.product.update({
        where: { id: product.id },
        data: {
          name: input.name,
          summary: input.summary,
          description: input.description,
          ...(input.markerCount !== undefined ? { markerCount: input.markerCount } : {}),
          priceCents: input.priceCents,
          promoPriceCents: input.promoPriceCents ?? null,
          ...(input.maxInstallments !== undefined
            ? { maxInstallments: input.maxInstallments }
            : {}),
          highlight: input.highlight ?? null,
          // A foto principal acompanha a galeria; sem galeria no corpo, vale o
          // campo antigo. Um PUT sem nenhum dos dois não apaga a foto.
          ...(input.images !== undefined
            ? { imageUrl: input.images[0] ?? null }
            : input.imageUrl !== undefined
              ? { imageUrl: input.imageUrl }
              : {}),
          weightGrams: input.weightGrams ?? null,
          dimensionsCm: input.dimensionsCm ?? null,
          category: input.category ?? null,
          features: {
            create: (input.features ?? []).map((label, index) => ({ label, position: index })),
          },
        },
        include: ADMIN_PRODUCT_INCLUDE,
      });
    });

    return ok(toAdminProductView(updated));
  }
}
