import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';

import { toAdminProductView, type AdminProductView } from '../admin-product.view';

export interface AdminProductListItem extends AdminProductView {
  readonly salesThisMonth: number;
}

/**
 * Admin product grid: every product — unpublished and archived included — with
 * the current month's sales figure (tela adm-7).
 */
@Injectable()
export class AdminListProductsUseCase {
  constructor(private readonly prisma: PrismaService) {}

  /** All products with ordered features and the "N vendas/mês" count. */
  async execute(): Promise<AdminProductListItem[]> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [products, sales] = await Promise.all([
      this.prisma.product.findMany({
        orderBy: { position: 'asc' },
        include: { features: { orderBy: { position: 'asc' } } },
      }),
      this.prisma.orderItem.groupBy({
        by: ['productSlug'],
        where: { order: { paidAt: { gte: monthStart } } },
        _sum: { quantity: true },
      }),
    ]);

    const salesBySlug = new Map(
      sales.map((group) => [group.productSlug, group._sum.quantity ?? 0]),
    );

    return products.map((product) => ({
      ...toAdminProductView(product),
      salesThisMonth: salesBySlug.get(product.slug) ?? 0,
    }));
  }
}
