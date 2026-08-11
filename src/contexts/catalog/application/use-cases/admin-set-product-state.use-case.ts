import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

export interface ProductStateInput {
  readonly published?: boolean;
  readonly archived?: boolean;
}

export interface ProductStateView {
  readonly slug: string;
  readonly published: boolean;
  readonly archived: boolean;
}

/**
 * Publishes, unpublishes, archives or restores a product — the inline card
 * actions of the admin grid (tela adm-7).
 *
 * Archiving always unpublishes: an archived product cannot stay on the
 * storefront. Publishing an archived product restores it, so the "Publicar"
 * button of the archived card works in a single call.
 */
@Injectable()
export class AdminSetProductStateUseCase {
  constructor(private readonly prisma: PrismaService) {}

  /** Applies the requested state, resolving the archive/publish precedence. */
  async execute(slug: string, input: ProductStateInput): Promise<Result<ProductStateView>> {
    const product = await this.prisma.product.findUnique({ where: { slug } });
    if (!product) return fail(new NotFoundError('Produto não encontrado.'));

    let published = input.published ?? product.published;
    let archived = input.archived ?? product.archived;

    if (input.archived === true) {
      published = false;
      archived = true;
    } else if (input.published === true) {
      archived = false;
    }

    const updated = await this.prisma.product.update({
      where: { id: product.id },
      data: { published, archived },
    });

    return ok({ slug: updated.slug, published: updated.published, archived: updated.archived });
  }
}
