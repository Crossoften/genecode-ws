import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { IsPublic, RequirePermissions } from '@contexts/identity/presentation/decorators';

import { ExportNewsletterUseCase } from '../../application/use-cases/export-newsletter.use-case';
import { SubscribeNewsletterUseCase } from '../../application/use-cases/subscribe-newsletter.use-case';
import { SubscribeNewsletterDto } from '../dtos/newsletter.dto';

/**
 * Newsletter do rodapé — "Fique por dentro" (GC-N05-17).
 *
 * A inscrição é pública (quem lê o rodapé não tem conta) e por isso tem rate
 * limit próprio, mais apertado que o global, como os demais formulários
 * públicos. A resposta é sempre a mesma — ver `NEWSLETTER_RESPONSE`.
 */
@ApiTags('Newsletter')
@Controller()
export class NewsletterController {
  constructor(
    private readonly subscribe: SubscribeNewsletterUseCase,
    private readonly exportCsv: ExportNewsletterUseCase,
  ) {}

  @Post('newsletter')
  @IsPublic()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Inscreve um e-mail na newsletter (rodapé do site)' })
  @ApiResponse({ status: 202, description: 'Recebido — igual para e-mail novo ou já inscrito' })
  async signUp(@Body() dto: SubscribeNewsletterDto) {
    return this.subscribe.execute({
      email: dto.email,
      source: dto.source ?? 'rodape',
      consentText: dto.consentText.trim(),
    });
  }

  /**
   * CSV dos inscritos para o admin. Usa a permissão de mensageria
   * (`notifications.read`), a mesma da tela de notificações — a lista é dado
   * de comunicação, e assim não precisa de papel novo no seed.
   */
  @Get('admin/newsletter/inscricoes.csv')
  @RequirePermissions('notifications.read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="newsletter-genecode.csv"')
  @ApiTags('Admin')
  @ApiOperation({ summary: 'Inscritos da newsletter em CSV' })
  async csv() {
    return this.exportCsv.execute();
  }
}
