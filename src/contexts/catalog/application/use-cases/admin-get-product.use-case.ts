import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

import { toAdminProductView, type AdminProductView } from '../admin-product.view';

/** Loads the full product for the admin edit form (tela adm-8). */
@Injectable()
export class AdminGetProductUseCase {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finds a product by slug, archived or not.
   *
   * @param slug - Product slug used as the admin route key.
   */
  async execute(slug: string): Promise<Result<AdminProductView>> {
    const product = await this.prisma.product.findUnique({
      where: { slug },
      include: { features: { orderBy: { position: 'asc' } } },
    });
    if (!product) return fail(new NotFoundError('Produto não encontrado.'));

    return ok(toAdminProductView(product));
  }
}
