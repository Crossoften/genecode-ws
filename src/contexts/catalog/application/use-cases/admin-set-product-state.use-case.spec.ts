import type { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError } from '@shared/domain/domain-error';

import { AdminSetProductStateUseCase } from './admin-set-product-state.use-case';

describe('AdminSetProductStateUseCase — arquivar despublica', () => {
  interface ProductRow {
    id: string;
    slug: string;
    published: boolean;
    archived: boolean;
  }

  function buildPrisma(product: ProductRow | null) {
    return {
      product: {
        findUnique: jest.fn(async () => product),
        update: jest.fn(
          async ({ data }: { data: { published: boolean; archived: boolean } }) => ({
            ...(product as ProductRow),
            ...data,
          }),
        ),
      },
    };
  }

  const useCase = (prisma: ReturnType<typeof buildPrisma>) =>
    new AdminSetProductStateUseCase(prisma as unknown as PrismaService);

  it('arquivar um produto publicado também o despublica', async () => {
    const prisma = buildPrisma({ id: 'p1', slug: 'premium', published: true, archived: false });

    const result = await useCase(prisma).execute('premium', { archived: true });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({ slug: 'premium', published: false, archived: true });
    }
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { published: false, archived: true } }),
    );
  });

  it('publicar um produto arquivado o desarquiva na mesma chamada', async () => {
    const prisma = buildPrisma({ id: 'p1', slug: 'essencial', published: false, archived: true });

    const result = await useCase(prisma).execute('essencial', { published: true });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({ slug: 'essencial', published: true, archived: false });
    }
  });

  it('despublicar não mexe no arquivamento', async () => {
    const prisma = buildPrisma({ id: 'p1', slug: 'premium', published: true, archived: false });

    const result = await useCase(prisma).execute('premium', { published: false });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({ slug: 'premium', published: false, archived: false });
    }
  });

  it('devolve NotFoundError quando o slug não existe', async () => {
    const prisma = buildPrisma(null);

    const result = await useCase(prisma).execute('inexistente', { archived: true });

    expect(result.isFail()).toBe(true);
    if (result.isFail()) expect(result.error).toBeInstanceOf(NotFoundError);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });
});
