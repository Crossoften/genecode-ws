import type { PrismaService } from '@infra/database/prisma.service';
import { ConflictError } from '@shared/domain/domain-error';

import { AdminCreateProductUseCase, type CreateProductInput } from './admin-create-product.use-case';

describe('AdminCreateProductUseCase — nasce despublicado, slug derivado do nome', () => {
  const baseInput: CreateProductInput = {
    name: 'GeneCode Nutrigenética',
    summary: 'Análise nutricional.',
    description: 'Descrição completa.',
    priceCents: 34_900,
    features: ['Kit de coleta', 'Laudo interativo'],
  };

  function buildPrisma(existingSlug: string | null) {
    return {
      product: {
        findUnique: jest.fn(async ({ where }: { where: { slug: string } }) =>
          where.slug === existingSlug ? { id: 'existente', slug: existingSlug } : null,
        ),
        aggregate: jest.fn(async () => ({ _max: { position: 2 } })),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'novo',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
          features: (data.features as { create: { label: string; position: number }[] }).create.map(
            (feature, index) => ({ id: `f${index}`, productId: 'novo', ...feature }),
          ),
        })),
      },
    };
  }

  const useCase = (prisma: ReturnType<typeof buildPrisma>) =>
    new AdminCreateProductUseCase(prisma as unknown as PrismaService);

  it('deriva o slug do nome quando ausente', async () => {
    const prisma = buildPrisma(null);

    const result = await useCase(prisma).execute(baseInput);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.slug).toBe('genecode-nutrigenetica');
  });

  it('sempre cria despublicado, mesmo sem o campo no input', async () => {
    const prisma = buildPrisma(null);

    const result = await useCase(prisma).execute(baseInput);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.published).toBe(false);
      expect(result.value.archived).toBe(false);
    }
    const createArgs = prisma.product.create.mock.calls[0][0];
    expect(createArgs.data.published).toBe(false);
  });

  it('respeita o slug explícito quando informado', async () => {
    const prisma = buildPrisma(null);

    const result = await useCase(prisma).execute({ ...baseInput, slug: 'nutri-custom' });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.slug).toBe('nutri-custom');
  });

  it('recusa slug já em uso com ConflictError', async () => {
    const prisma = buildPrisma('genecode-nutrigenetica');

    const result = await useCase(prisma).execute(baseInput);

    expect(result.isFail()).toBe(true);
    if (result.isFail()) expect(result.error).toBeInstanceOf(ConflictError);
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('posiciona o produto novo no fim da vitrine', async () => {
    const prisma = buildPrisma(null);

    await useCase(prisma).execute(baseInput);

    const createArgs = prisma.product.create.mock.calls[0][0];
    expect(createArgs.data.position).toBe(3);
  });
});
