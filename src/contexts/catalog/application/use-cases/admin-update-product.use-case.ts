import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

import { toAdminProductView, type AdminProductView } from '../admin-product.view';
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
          // Sem provedor de mídia o form ainda não envia imagem; um PUT sem o
          // campo não pode apagar a imagem que já existe.
          ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
          weightGrams: input.weightGrams ?? null,
          dimensionsCm: input.dimensionsCm ?? null,
          category: input.category ?? null,
          features: {
            create: (input.features ?? []).map((label, index) => ({ label, position: index })),
          },
        },
        include: { features: { orderBy: { position: 'asc' } } },
      });
    });

    return ok(toAdminProductView(updated));
  }
}
