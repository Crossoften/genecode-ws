import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { CurrentUser, RequireRoles } from '@contexts/identity/presentation/decorators';
import type { AuthenticatedPrincipal } from '@contexts/identity/presentation/guards/jwt-auth.guard';
import { PrismaService } from '@infra/database/prisma.service';

import { ConsolidatedReportUseCase } from '../../application/use-cases/consolidated-report.use-case';
import { ManageSharingUseCase } from '../../application/use-cases/manage-sharing.use-case';
import { CreateProfessionalDto, GrantSharingDto } from '../dtos/coaching.dto';

@ApiTags('Profissional')
@Controller()
export class CoachingController {
  constructor(
    private readonly sharing: ManageSharingUseCase,
    private readonly consolidated: ConsolidatedReportUseCase,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Cria o perfil profissional.
   *
   * Sem aprovação e sem validação de conselho, por decisão do cliente. Um
   * profissional recém-cadastrado **não vê absolutamente nada** até que alguém
   * compartilhe — foi o desenho aprovado em 16/07.
   */
  @Post('profissional/perfil')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Cria o perfil profissional com especialidade autodeclarada' })
  async createProfile(
    @Body() dto: CreateProfessionalDto,
    @CurrentUser() user: AuthenticatedPrincipal,
  ) {
    const profile = await this.prisma.professionalProfile.upsert({
      where: { userId: user.id },
      update: { specialty: dto.specialty, councilId: dto.councilId, bio: dto.bio },
      create: { userId: user.id, specialty: dto.specialty, councilId: dto.councilId, bio: dto.bio },
    });

    const role = await this.prisma.role.findUnique({ where: { slug: 'professional' } });
    if (role) {
      await this.prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: role.id } },
        update: {},
        create: { userId: user.id, roleId: role.id },
      });
    }

    return { id: profile.id, specialty: profile.specialty };
  }

  /** Estado do compartilhamento da conta logada — a tela de privacidade lê daqui. */
  @Get('meus-dados/compartilhamentos')
  @ApiOperation({ summary: 'Compartilhamentos vigentes dos titulares desta conta' })
  async list(@CurrentUser() user: AuthenticatedPrincipal) {
    const links = await this.prisma.subjectLink.findMany({
      where: { userId: user.id },
      select: { subjectId: true },
    });
    return this.sharing.listForSubjects(links.map((link) => link.subjectId));
  }

  /** O titular autoriza um profissional. Efeito imediato. */
  @Post('meus-dados/compartilhamentos')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Autoriza um profissional a ver o laudo consolidado' })
  async grant(
    @Body() dto: GrantSharingDto,
    @CurrentUser() user: AuthenticatedPrincipal,
    @Req() request: Request,
  ) {
    const subjectId = await this.resolveSubject(user.id);
    if (!subjectId) throw new Error('Nenhum kit ativado nesta conta.');

    const result = await this.sharing.grantByPatient(
      subjectId,
      dto.professionalEmail,
      user.id,
      request.ip,
    );
    if (result.isFail()) throw result.error;
    return result.value;
  }

  /** O titular revoga, a qualquer momento. */
  @Delete('meus-dados/compartilhamentos/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoga o acesso de um profissional' })
  async revoke(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedPrincipal,
    @Req() request: Request,
  ): Promise<void> {
    // TODOS os titulares da conta: a tela de privacidade lista os sharings de
    // todos, então a revogação precisa alcançar todos — não só o kit mais
    // recente (direito de revogação da LGPD para conta com 2+ kits).
    const links = await this.prisma.subjectLink.findMany({
      where: { userId: user.id },
      select: { subjectId: true },
    });

    const result = await this.sharing.revoke(
      links.map((link) => link.subjectId),
      id,
      user.id,
      request.ip,
    );
    if (result.isFail()) throw result.error;
  }

  /**
   * Patient cards for the professional's dashboard.
   *
   * Includes REVOKED sharings so the screen can show the "consent revoked"
   * card; the consolidated report endpoint is what denies the actual access.
   */
  @Get('profissional/pacientes')
  @RequireRoles('professional')
  @ApiOperation({ summary: 'Cards de quem compartilhou com este profissional (inclui revogados)' })
  async patients(@CurrentUser() user: AuthenticatedPrincipal) {
    const profile = await this.prisma.professionalProfile.findUnique({
      where: { userId: user.id },
    });
    if (!profile) return [];
    return this.sharing.listForProfessional(profile.id);
  }

  /**
   * Laudo consolidado de um titular autorizado.
   *
   * Nunca devolve genótipo. A autorização é checada no caso de uso, não só aqui:
   * o guard sabe que a pessoa é profissional, não que ela pode ver *este* titular.
   */
  @Get('profissional/pacientes/:subjectId/laudo')
  @RequireRoles('professional')
  @ApiOperation({ summary: 'Laudo consolidado, sem genótipo' })
  async report(
    @Param('subjectId') subjectId: string,
    @CurrentUser() user: AuthenticatedPrincipal,
  ) {
    const profile = await this.prisma.professionalProfile.findUnique({
      where: { userId: user.id },
    });
    if (!profile) throw new Error('Perfil profissional não encontrado.');

    const result = await this.consolidated.execute(subjectId, profile.id);
    if (result.isFail()) throw result.error;
    return result.value;
  }

  /** Titular vinculado à conta. Vem da ativação do kit. */
  private async resolveSubject(userId: string): Promise<string | null> {
    const link = await this.prisma.subjectLink.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return link?.subjectId ?? null;
  }
}
