import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';

import type {
  IssueRefreshTokenInput,
  RefreshTokenRecord,
  RefreshTokenRepository,
} from '../../domain/ports/refresh-token.repository';

const TOKEN_SELECT = {
  id: true,
  userId: true,
  expiresAt: true,
  revokedAt: true,
  replacedById: true,
} as const;

/** Prisma-backed implementation of {@link RefreshTokenRepository}. */
@Injectable()
export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async issue(input: IssueRefreshTokenInput): Promise<RefreshTokenRecord> {
    return this.prisma.refreshToken.create({
      data: {
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
      },
      select: TOKEN_SELECT,
    });
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: TOKEN_SELECT,
    });
  }

  /**
   * Revokes the current token and issues its replacement atomically.
   *
   * The two writes are wrapped in a transaction because a failure between them
   * would either leave two valid tokens for one session, or revoke the old one
   * without handing back a new one — locking the user out mid-request.
   */
  async rotate(oldId: string, next: IssueRefreshTokenInput): Promise<RefreshTokenRecord> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({
        data: {
          userId: next.userId,
          tokenHash: next.tokenHash,
          expiresAt: next.expiresAt,
          userAgent: next.userAgent,
          ipAddress: next.ipAddress,
        },
        select: TOKEN_SELECT,
      });

      await tx.refreshToken.update({
        where: { id: oldId },
        data: { revokedAt: new Date(), replacedById: created.id },
      });

      return created;
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async deleteExpired(): Promise<number> {
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return count;
  }
}
