import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { RefreshSessionUseCase } from '../../application/use-cases/refresh-session.use-case';
import { RegisterUserUseCase } from '../../application/use-cases/register-user.use-case';
import { ResetPasswordUseCase } from '../../application/use-cases/reset-password.use-case';
import { VerifyEmailUseCase } from '../../application/use-cases/verify-email.use-case';
import { IsPublic } from '../decorators';
import {
  ForgotPasswordDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from '../dtos/account.dto';

/**
 * Ciclo de vida da conta: cadastro, verificação, sessão e senha.
 *
 * Todas as rotas são públicas por natureza — quem ainda não tem conta não tem
 * token — e por isso todas têm rate limit próprio, mais apertado que o global.
 * São exatamente os endpoints que um atacante usaria para enumerar contas ou
 * forçar códigos.
 */
@ApiTags('Conta')
@Controller('conta')
export class AccountController {
  constructor(
    private readonly register: RegisterUserUseCase,
    private readonly verifyEmail: VerifyEmailUseCase,
    private readonly resetPassword: ResetPasswordUseCase,
    private readonly refreshSession: RefreshSessionUseCase,
  ) {}

  /** Cria a conta em estado pendente e envia o código de verificação. */
  @Post('cadastro')
  @IsPublic()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Cria uma conta e envia o código de verificação' })
  @ApiResponse({ status: 201, description: 'Cadastro recebido; código enviado por e-mail' })
  async signUp(@Body() dto: RegisterDto, @Req() request: Request) {
    const result = await this.register.execute({
      name: dto.name,
      email: dto.email,
      password: dto.password,
      document: dto.document,
      phone: dto.phone,
      acceptedConsents: dto.acceptedConsents,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    if (result.isFail()) throw result.error;
    return { verificationSent: result.value.verificationSent };
  }

  /** Confirma o e-mail e já abre a sessão. */
  @Post('verificacao')
  @IsPublic()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Confirma o e-mail com o código de 6 dígitos' })
  async verify(@Body() dto: VerifyEmailDto, @Req() request: Request) {
    const result = await this.verifyEmail.execute({
      email: dto.email,
      code: dto.code,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    if (result.isFail()) throw result.error;
    return result.value.tokens;
  }

  /**
   * Solicita a redefinição de senha.
   *
   * Responde 204 sempre, exista a conta ou não — o contrário transformaria a
   * rota num verificador de quem é cliente do laboratório.
   */
  @Post('senha/esqueci')
  @IsPublic()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Envia o link de redefinição de senha' })
  async forgot(@Body() dto: ForgotPasswordDto): Promise<void> {
    const result = await this.resetPassword.request(dto.email);
    if (result.isFail()) throw result.error;
  }

  /** Redefine a senha e derruba todas as sessões abertas. */
  @Post('senha/redefinir')
  @IsPublic()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Redefine a senha a partir do token recebido' })
  async reset(@Body() dto: ResetPasswordDto): Promise<void> {
    const result = await this.resetPassword.confirm(dto.token, dto.password);
    if (result.isFail()) throw result.error;
  }

  /** Renova a sessão, rotacionando o refresh token. */
  @Post('sessao/renovar')
  @IsPublic()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renova o access token' })
  async refresh(@Body() dto: RefreshDto, @Req() request: Request) {
    const result = await this.refreshSession.execute({
      refreshToken: dto.refreshToken,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    if (result.isFail()) throw result.error;
    return result.value.tokens;
  }
}
