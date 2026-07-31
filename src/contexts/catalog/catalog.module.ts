import { Module } from '@nestjs/common';

import { ListProductsUseCase } from './application/use-cases/list-products.use-case';
import { RecommendProductUseCase } from './application/use-cases/recommend-product.use-case';
import { CatalogController } from './presentation/controllers/catalog.controller';

/** Contexto de catálogo: produtos da vitrine e quiz de recomendação. */
@Module({
  controllers: [CatalogController],
  providers: [ListProductsUseCase, RecommendProductUseCase],
  exports: [ListProductsUseCase],
})
export class CatalogModule {}
