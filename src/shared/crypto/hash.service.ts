import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { compare, hash } from 'bcrypt';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { Env } from '../config/env.schema';

/**
 * Hashing and token generation.
 *
 * Two different primitives, used for two different jobs:
 *
 * - **bcrypt** for passwords. Deliberately slow, to make offline cracking of a
 *   leaked dump expensive.
 * - **SHA-256** for opaque tokens (refresh, password reset, verification codes).
 *   These already carry full entropy from `randomBytes`, so stretching them buys
 *   nothing — we hash only so that a database leak does not hand out live
 *   sessions.
 */
@Injectable()
export class HashService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  /** Hashes a plaintext password with the configured bcrypt cost. */
  async hashPassword(plain: string): Promise<string> {
    return hash(plain, this.config.get('BCRYPT_ROUNDS', { infer: true }));
  }

  /** Verifies a plaintext password against a bcrypt hash. */
  async verifyPassword(plain: string, hashed: string): Promise<boolean> {
    return compare(plain, hashed);
  }

  /**
   * Generates a cryptographically random opaque token.
   *
   * Returns both the plaintext — shown to the user exactly once — and the hash
   * that gets persisted.
   *
   * @param bytes - Entropy in bytes. 32 bytes = 256 bits.
   */
  generateToken(bytes = 32): { token: string; tokenHash: string } {
    const token = randomBytes(bytes).toString('base64url');
    return { token, tokenHash: this.hashToken(token) };
  }

  /**
   * Generates a numeric verification code for the 6-digit input screens.
   *
   * Uses `randomBytes` rather than `Math.random`: the previous implementation
   * produced 4 non-repeating digits from a non-cryptographic source, leaving only
   * 5,040 possible values.
   *
   * @param digits - Code length. The approved prototype uses 6.
   */
  generateNumericCode(digits = 6): { code: string; codeHash: string } {
    const max = 10 ** digits;
    // Rejection sampling keeps the distribution uniform — taking a modulo of a
    // random integer would bias the low end of the range.
    const limit = Math.floor(0xffffffff / max) * max;
    let value: number;
    do {
      value = randomBytes(4).readUInt32BE(0);
    } while (value >= limit);

    const code = String(value % max).padStart(digits, '0');
    return { code, codeHash: this.hashToken(code) };
  }

  /** Hashes an opaque token or code for storage. */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Compares two token hashes in constant time.
   *
   * A plain `===` leaks information through how long it takes to fail, which is
   * enough to recover a secret byte by byte over many attempts.
   */
  safeCompare(a: string, b: string): boolean {
    const bufferA = Buffer.from(a, 'utf8');
    const bufferB = Buffer.from(b, 'utf8');
    if (bufferA.length !== bufferB.length) return false;
    return timingSafeEqual(bufferA, bufferB);
  }
}
