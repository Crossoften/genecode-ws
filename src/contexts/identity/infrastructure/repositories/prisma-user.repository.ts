import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';

import type {
  CreateUserInput,
  UserRecord,
  UserRepository,
} from '../../domain/ports/user.repository';
import type { Email } from '../../domain/value-objects/email';

/** Shape returned by every query below, so mapping stays in one place. */
const USER_SELECT = {
  id: true,
  email: true,
  password: true,
  name: true,
  status: true,
  emailVerifiedAt: true,
  twoFactorEnabled: true,
  deletedAt: true,
  roles: {
    select: {
      role: {
        select: {
          slug: true,
          permissions: { select: { permission: { select: { slug: true } } } },
        },
      },
    },
  },
} as const;

type RawUser = {
  id: string;
  email: string;
  password: string;
  name: string;
  status: UserRecord['status'];
  emailVerifiedAt: Date | null;
  twoFactorEnabled: boolean;
  deletedAt: Date | null;
  roles: { role: { slug: string; permissions: { permission: { slug: string } }[] } }[];
};

/**
 * Prisma-backed implementation of {@link UserRepository}.
 *
 * Every read filters on `deletedAt: null`. Soft-deleted accounts stay in the
 * table to preserve the audit trail, but must behave as if they do not exist.
 */
@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: Email): Promise<UserRecord | null> {
    const user = await this.prisma.user.findFirst({
      where: { email: email.value, deletedAt: null },
      select: USER_SELECT,
    });
    return user ? this.toRecord(user) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: USER_SELECT,
    });
    return user ? this.toRecord(user) : null;
  }

  async existsByEmail(email: Email): Promise<boolean> {
    const count = await this.prisma.user.count({
      where: { email: email.value, deletedAt: null },
    });
    return count > 0;
  }

  async create(input: CreateUserInput): Promise<UserRecord> {
    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        password: input.passwordHash,
        name: input.name,
        document: input.document,
        phone: input.phone,
        status: 'PENDING',
      },
      select: USER_SELECT,
    });
    return this.toRecord(user);
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: passwordHash },
    });
  }

  async markEmailVerified(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
    });
  }

  /**
   * Maps the Prisma row to the domain shape, flattening role permissions.
   *
   * Renaming `password` to `passwordHash` here is deliberate: the column name is
   * misleading, and the domain should never look like it holds a plaintext.
   */
  private toRecord(user: RawUser): UserRecord {
    const roles = user.roles.map((entry) => entry.role.slug);
    const permissions = [
      ...new Set(
        user.roles.flatMap((entry) => entry.role.permissions.map((rp) => rp.permission.slug)),
      ),
    ];

    return {
      id: user.id,
      email: user.email,
      passwordHash: user.password,
      name: user.name,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      twoFactorEnabled: user.twoFactorEnabled,
      deletedAt: user.deletedAt,
      roles,
      permissions,
    };
  }
}
