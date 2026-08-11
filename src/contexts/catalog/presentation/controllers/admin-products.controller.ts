import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '@contexts/identity/presentation/decorators';

import { AdminCreateProductUseCase } from '../../application/use-cases/admin-create-product.use-case';
import { AdminGetProductUseCase } from '../../application/use-cases/admin-get-product.use-case';
import { AdminListProductsUseCase } from '../../application/use-cases/admin-list-products.use-case';
import { AdminSetProductStateUseCase } from '../../application/use-cases/admin-set-product-state.use-case';
import { AdminUpdateProductUseCase } from '../../application/use-cases/admin-update-product.use-case';
import { CreateProductDto, SetProductStateDto, UpdateProductDto } from '../dtos/admin-product.dto';

@ApiTags('Admin · Produtos')
@Controller('admin/produtos')
export class AdminProductsController {
  constructor(
    private readonly listProducts: AdminListProductsUseCase,
    private readonly getProduct: AdminGetProductUseCase,
    private readonly createProduct: AdminCreateProductUseCase,
    private readonly updateProduct: AdminUpdateProductUseCase,
    private readonly setState: AdminSetProductStateUseCase,
  ) {}

  /** Product grid, archived and unpublished included (tela adm-7). */
  @Get()
  @RequirePermissions('products.read')
  @ApiOperation({ summary: 'Lista todos os produtos com as vendas do mês' })
  async list() {
    return this.listProducts.execute();
  }

  /** Full product for the edit form (tela adm-8). */
  @Get(':slug')
  @RequirePermissions('products.read')
  @ApiOperation({ summary: 'Produto completo para o formulário' })
  async get(@Param('slug') slug: string) {
    const result = await this.getProduct.execute(slug);
    if (result.isFail()) throw result.error;
    return result.value;
  }

  /** Creates a product; every new product starts unpublished. */
  @Post()
  @RequirePermissions('products.write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Cria um produto (nasce despublicado)' })
  async create(@Body() dto: CreateProductDto) {
    const result = await this.createProduct.execute(dto);
    if (result.isFail()) throw result.error;
    return result.value;
  }

  /** Updates the product fields and replaces the feature list. */
  @Put(':slug')
  @RequirePermissions('products.write')
  @ApiOperation({ summary: 'Atualiza o produto e substitui os itens inclusos' })
  async update(@Param('slug') slug: string, @Body() dto: UpdateProductDto) {
    const result = await this.updateProduct.execute(slug, dto);
    if (result.isFail()) throw result.error;
    return result.value;
  }

  /** Publishes, unpublishes, archives or restores a product. */
  @Patch(':slug/estado')
  @RequirePermissions('products.write')
  @ApiOperation({ summary: 'Altera publicação/arquivamento (arquivar despublica)' })
  async changeState(@Param('slug') slug: string, @Body() dto: SetProductStateDto) {
    const result = await this.setState.execute(slug, dto);
    if (result.isFail()) throw result.error;
    return result.value;
  }
}
