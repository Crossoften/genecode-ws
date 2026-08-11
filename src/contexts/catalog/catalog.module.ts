import { Module } from '@nestjs/common';

import { AdminCreateProductUseCase } from './application/use-cases/admin-create-product.use-case';
import { AdminGetProductUseCase } from './application/use-cases/admin-get-product.use-case';
import { AdminListProductsUseCase } from './application/use-cases/admin-list-products.use-case';
import { AdminSetProductStateUseCase } from './application/use-cases/admin-set-product-state.use-case';
import { AdminUpdateProductUseCase } from './application/use-cases/admin-update-product.use-case';
import { ListProductsUseCase } from './application/use-cases/list-products.use-case';
import { RecommendProductUseCase } from './application/use-cases/recommend-product.use-case';
import { AdminProductsController } from './presentation/controllers/admin-products.controller';
import { CatalogController } from './presentation/controllers/catalog.controller';

/** Contexto de catálogo: produtos da vitrine, quiz e gestão admin do catálogo. */
@Module({
  controllers: [CatalogController, AdminProductsController],
  providers: [
    ListProductsUseCase,
    RecommendProductUseCase,
    AdminListProductsUseCase,
    AdminGetProductUseCase,
    AdminCreateProductUseCase,
    AdminUpdateProductUseCase,
    AdminSetProductStateUseCase,
  ],
  exports: [ListProductsUseCase],
})
export class CatalogModule {}
