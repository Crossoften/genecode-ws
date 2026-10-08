import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

import {
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '@contexts/identity/presentation/decorators';
import type { Env } from '@shared/config/env.schema';
import { ValidationError } from '@shared/domain/domain-error';

/**
 * O arquivo como o multer o entrega, só com o que este controller usa.
 *
 * Declarado aqui em vez de instalar `@types/multer`: o pacote existe só para
 * esta forma, e somar uma dependência obrigaria um `npm install` na VPS a cada
 * deploy do backend — que hoje é `git pull` + `nest build`.
 */
interface ArquivoEnviado {
  readonly buffer: Buffer;
  readonly originalname?: string;
  readonly mimetype?: string;
}

/** Teto por arquivo. Foto de kit em 800×800 cabe folgado. */
const TAMANHO_MAXIMO = 4 * 1024 * 1024;

/**
 * Tipos aceitos, por **conteúdo**, não por extensão.
 *
 * A chave é a assinatura dos primeiros bytes: a extensão vem do cliente e o
 * `mimetype` do multer também — os dois são texto que o cliente escolhe. Um
 * .php renomeado para .png passaria pelos dois e ficaria num diretório que o
 * servidor web publica.
 */
const ASSINATURAS: ReadonlyArray<{
  readonly ext: string;
  readonly mime: string;
  readonly casa: (b: Buffer) => boolean;
}> = [
  {
    ext: '.png',
    mime: 'image/png',
    casa: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    ext: '.jpg',
    mime: 'image/jpeg',
    casa: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: '.webp',
    mime: 'image/webp',
    casa: (b) =>
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

@ApiTags('Admin')
@Controller('admin/midia')
export class MediaController {
  private readonly logger = new Logger(MediaController.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  /**
   * Recebe a foto do kit e devolve a URL pública para gravar em `imageUrl`.
   *
   * Guardado em disco da própria VPS, servido como estático pelo bootstrap.
   * Não há CDN contratada, e um punhado de fotos de kit não justifica uma.
   *
   * O nome do arquivo é gerado aqui, nunca o que veio no upload: nome de
   * cliente é texto de cliente, e `../../` dentro dele escreveria fora do
   * diretório.
   */
  @Post('produto')
  @RequirePermissions('products.write')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({ summary: 'Envia a foto do kit e devolve a URL pública' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: TAMANHO_MAXIMO } }))
  async enviarFotoDoProduto(@UploadedFile() file?: ArquivoEnviado) {
    if (!file?.buffer?.length) {
      throw new ValidationError('Envie um arquivo de imagem.', {
        fields: { file: 'Nenhum arquivo recebido.' },
      });
    }

    const tipo = ASSINATURAS.find((a) => a.casa(file.buffer));
    if (!tipo) {
      throw new ValidationError('Formato não aceito. Use PNG, JPG ou WebP.', {
        fields: { file: 'Formato não aceito. Use PNG, JPG ou WebP.' },
      });
    }

    const nome = `${randomUUID()}${tipo.ext}`;
    const diretorio = resolve(this.config.get('UPLOADS_DIR', { infer: true }));

    mkdirSync(diretorio, { recursive: true });
    writeFileSync(join(diretorio, nome), file.buffer);

    const base = this.config.get('UPLOADS_PUBLIC_URL', { infer: true }).replace(/\/+$/, '');
    const url = `${base}/${nome}`;

    this.logger.log(`Foto de produto gravada: ${nome} (${file.buffer.length} bytes, ${tipo.mime})`);

    // `extname` do nome original aparece só no log de auditoria, nunca no disco.
    this.logger.debug(`Nome de origem descartado: ${extname(file.originalname || '')}`);

    return { url, contentType: tipo.mime, bytes: file.buffer.length };
  }
}
