import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { AuthenticateUseCase } from '../../application/use-cases/authenticate.use-case';
import { CurrentUser, IsPublic } from '../decorators';
import { AuthResponseDto, LoginDto } from '../dtos/auth.dto';
import type { AuthenticatedPrincipal } from '../guards/jwt-auth.guard';

@ApiTags('Autenticação')
@Controller('auth')
export class AuthController {
  constructor(private readonly authenticate: AuthenticateUseCase) {}

  /**
   * Authenticates a user and opens a session.
   *
   * Rate limited well below the global ceiling: this is the endpoint an attacker
   * would use to spray credentials, and it is cheap to call.
   */
  @Post('login')
  @IsPublic()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Autentica com e-mail e senha' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'E-mail ou senha inválidos' })
  async login(@Body() dto: LoginDto, @Req() request: Request): Promise<AuthResponseDto> {
    const result = await this.authenticate.execute({
      email: dto.email,
      password: dto.password,
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip,
    });

    // The filter turns the domain error into the right status and envelope.
    if (result.isFail()) throw result.error;

    const { user, tokens } = result.value;
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        roles: [...user.roles],
        permissions: [...user.permissions],
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    };
  }

  /**
   * Returns the caller's own profile.
   *
   * The principal is built by the guard from a fresh database read, so this
   * always reflects current roles and permissions.
   */
  @Get('me')
  @ApiOperation({ summary: 'Dados do usuário autenticado' })
  me(@CurrentUser() user: AuthenticatedPrincipal): AuthenticatedPrincipal {
    return user;
  }
}
