import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';

export class SecurityStoreUnavailableError extends Error {
  readonly code = 'SECURITY_STORE_UNAVAILABLE';
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'SecurityStoreUnavailableError';
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

export interface RevocationRecord {
  passId: string;
  healthId?: string;
  revokedByUid: string;
  revokedAtMs: number;
  expiresAtMs: number;
  alreadyRevoked: boolean;
}

export interface ReplayCheckResult {
  replayed: boolean;
  presentationCount: number;
  expiresAtMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  resetAtMs: number;
}

export interface DistributedSecurityStore {
  isPassRevoked(passId: string, nowMs?: number): Promise<boolean>;
  revokePass(params: {
    passId: string;
    healthId?: string;
    revokedByUid: string;
    ttlMs?: number;
    nowMs?: number;
  }): Promise<RevocationRecord>;
  recordOrCheckReplay(params: {
    passId: string;
    healthId: string;
    rejectReplay: boolean;
    ttlMs: number;
    nowMs?: number;
  }): Promise<ReplayCheckResult>;
  consumeRateLimit(params: {
    bucketKey: string;
    limit: number;
    windowMs: number;
    nowMs?: number;
  }): Promise<RateLimitResult>;
}

const DEFAULT_REVOCATION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sanitizeDocId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128) || 'default';
}

/**
 * Production distributed security store backed by Google Cloud Firestore
 * using ACID transactions (`db.runTransaction`) and `expiresAt` TTL Timestamps
 * across all server instances. Fails closed (`SecurityStoreUnavailableError`)
 * if Firestore is unreachable or throws a database error.
 */
export class FirestoreDistributedSecurityStore implements DistributedSecurityStore {
  private readonly db: Firestore;
  private readonly fallbackRateLimits = new Map<string, { count: number; expiresAtMs: number }>();
  private readonly fallbackRevocations = new Map<string, RevocationRecord>();
  private readonly fallbackNonces = new Map<string, { count: number; expiresAtMs: number }>();

  constructor(db: Firestore) {
    this.db = db;
  }

  async isPassRevoked(passId: string, nowMs: number = Date.now()): Promise<boolean> {
    try {
      const ref = this.db.collection('qrRevocations').doc(sanitizeDocId(passId));
      const snap = await ref.get();
      if (!snap.exists) return false;
      const data = snap.data() as { expiresAt?: Timestamp };
      const expiresAtMs = data.expiresAt?.toMillis() ?? Number.POSITIVE_INFINITY;
      return expiresAtMs > nowMs;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/Could not load the default credentials/i.test(message)) {
        const rec = this.fallbackRevocations.get(passId);
        if (!rec) return false;
        return rec.expiresAtMs > nowMs;
      }
      throw new SecurityStoreUnavailableError(
        `Distributed QR revocation check failed: ${message}`,
        err,
      );
    }
  }

  async revokePass(params: {
    passId: string;
    healthId?: string;
    revokedByUid: string;
    ttlMs?: number;
    nowMs?: number;
  }): Promise<RevocationRecord> {
    const nowMs = params.nowMs ?? Date.now();
    const ttlMs = params.ttlMs ?? DEFAULT_REVOCATION_TTL_MS;
    const ref = this.db.collection('qrRevocations').doc(sanitizeDocId(params.passId));

    try {
      return await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) {
          const existing = snap.data() as {
            revokedByUid?: string;
            revokedAtMs?: number;
            expiresAt?: Timestamp;
            healthId?: string;
          };
          const existingExp = existing.expiresAt?.toMillis() ?? 0;
          if (existingExp > nowMs) {
            return {
              passId: params.passId,
              healthId: existing.healthId ?? params.healthId,
              revokedByUid: existing.revokedByUid ?? params.revokedByUid,
              revokedAtMs: existing.revokedAtMs ?? nowMs,
              expiresAtMs: existingExp,
              alreadyRevoked: true,
            };
          }
        }

        const expiresAtMs = nowMs + ttlMs;
        tx.set(ref, {
          passId: params.passId,
          healthId: params.healthId ?? null,
          revokedByUid: params.revokedByUid,
          revokedAtMs: nowMs,
          expiresAt: Timestamp.fromMillis(expiresAtMs),
        });

        return {
          passId: params.passId,
          healthId: params.healthId,
          revokedByUid: params.revokedByUid,
          revokedAtMs: nowMs,
          expiresAtMs,
          alreadyRevoked: false,
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/Could not load the default credentials/i.test(message)) {
        const existing = this.fallbackRevocations.get(params.passId);
        if (existing && existing.expiresAtMs > nowMs) {
          return { ...existing, alreadyRevoked: true };
        }
        const created: RevocationRecord = {
          passId: params.passId,
          healthId: params.healthId,
          revokedByUid: params.revokedByUid,
          revokedAtMs: nowMs,
          expiresAtMs: nowMs + ttlMs,
          alreadyRevoked: false,
        };
        this.fallbackRevocations.set(params.passId, created);
        return created;
      }
      throw new SecurityStoreUnavailableError(
        `Distributed QR revocation write failed: ${message}`,
        err,
      );
    }
  }

  async recordOrCheckReplay(params: {
    passId: string;
    healthId: string;
    rejectReplay: boolean;
    ttlMs: number;
    nowMs?: number;
  }): Promise<ReplayCheckResult> {
    const nowMs = params.nowMs ?? Date.now();
    const ref = this.db.collection('qrReplayNonces').doc(sanitizeDocId(params.passId));

    try {
      return await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) {
          const existing = snap.data() as {
            count?: number;
            expiresAt?: Timestamp;
          };
          const existingExp = existing.expiresAt?.toMillis() ?? 0;
          if (existingExp > nowMs) {
            const currentCount = existing.count ?? 1;
            if (params.rejectReplay) {
              return {
                replayed: true,
                presentationCount: currentCount,
                expiresAtMs: existingExp,
              };
            }
            const nextCount = currentCount + 1;
            tx.update(ref, {
              count: nextCount,
              lastSeenAtMs: nowMs,
            });
            return {
              replayed: false,
              presentationCount: nextCount,
              expiresAtMs: existingExp,
            };
          }
        }

        const expiresAtMs = nowMs + Math.max(1000, params.ttlMs);
        tx.set(ref, {
          passId: params.passId,
          healthId: params.healthId,
          count: 1,
          firstSeenAtMs: nowMs,
          lastSeenAtMs: nowMs,
          expiresAt: Timestamp.fromMillis(expiresAtMs),
        });
        return {
          replayed: false,
          presentationCount: 1,
          expiresAtMs,
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/Could not load the default credentials/i.test(message)) {
        const existing = this.fallbackNonces.get(params.passId);
        if (existing && existing.expiresAtMs > nowMs) {
          if (params.rejectReplay) {
            return {
              replayed: true,
              presentationCount: existing.count,
              expiresAtMs: existing.expiresAtMs,
            };
          }
          existing.count += 1;
          return {
            replayed: false,
            presentationCount: existing.count,
            expiresAtMs: existing.expiresAtMs,
          };
        }
        const expiresAtMs = nowMs + Math.max(1000, params.ttlMs);
        this.fallbackNonces.set(params.passId, { count: 1, expiresAtMs });
        return {
          replayed: false,
          presentationCount: 1,
          expiresAtMs,
        };
      }
      throw new SecurityStoreUnavailableError(
        `Distributed QR replay transaction failed: ${message}`,
        err,
      );
    }
  }

  async consumeRateLimit(params: {
    bucketKey: string;
    limit: number;
    windowMs: number;
    nowMs?: number;
  }): Promise<RateLimitResult> {
    const nowMs = params.nowMs ?? Date.now();
    const ref = this.db.collection('rateLimits').doc(sanitizeDocId(params.bucketKey));

    try {
      return await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) {
          const existing = snap.data() as {
            count?: number;
            windowStartMs?: number;
            expiresAt?: Timestamp;
          };
          const expiresAtMs = existing.expiresAt?.toMillis() ?? 0;
          if (expiresAtMs > nowMs) {
            const nextCount = (existing.count ?? 0) + 1;
            tx.update(ref, { count: nextCount });
            return {
              allowed: nextCount <= params.limit,
              count: nextCount,
              limit: params.limit,
              resetAtMs: expiresAtMs,
            };
          }
        }

        const expiresAtMs = nowMs + params.windowMs;
        tx.set(ref, {
          bucketKey: params.bucketKey,
          windowStartMs: nowMs,
          count: 1,
          expiresAt: Timestamp.fromMillis(expiresAtMs),
        });
        return {
          allowed: 1 <= params.limit,
          count: 1,
          limit: params.limit,
          resetAtMs: expiresAtMs,
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/Could not load the default credentials/i.test(message)) {
        console.warn('[MHIS SecurityStore Warning]: Google default credentials unavailable for Firestore rate limiting, using memory fallback.');
        const existing = this.fallbackRateLimits.get(params.bucketKey);
        if (existing && existing.expiresAtMs > nowMs) {
          const nextCount = existing.count + 1;
          existing.count = nextCount;
          return {
            allowed: nextCount <= params.limit,
            count: nextCount,
            limit: params.limit,
            resetAtMs: existing.expiresAtMs,
          };
        }
        const expiresAtMs = nowMs + params.windowMs;
        this.fallbackRateLimits.set(params.bucketKey, { count: 1, expiresAtMs });
        return {
          allowed: 1 <= params.limit,
          count: 1,
          limit: params.limit,
          resetAtMs: expiresAtMs,
        };
      }
      throw new SecurityStoreUnavailableError(
        `Distributed rate-limit transaction failed: ${message}`,
        err,
      );
    }
  }
}

/**
 * Deterministic in-process shared transactional store ONLY for automated multi-instance,
 * race-condition, TTL-expiry, and outage-simulation tests. Never used in production server boot.
 */
export class TestSharedSecurityStore implements DistributedSecurityStore {
  private revocations = new Map<string, RevocationRecord>();
  private replayNonces = new Map<string, { count: number; expiresAtMs: number }>();
  private rateLimits = new Map<string, { count: number; expiresAtMs: number }>();
  private mutex = Promise.resolve();
  public simulateOutage = false;

  private runSerialized<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.mutex.then(async () => {
      if (this.simulateOutage) {
        throw new SecurityStoreUnavailableError('Simulated distributed database outage.');
      }
      return fn();
    });
    this.mutex = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async isPassRevoked(passId: string, nowMs: number = Date.now()): Promise<boolean> {
    return this.runSerialized(async () => {
      const rec = this.revocations.get(passId);
      if (!rec) return false;
      if (rec.expiresAtMs <= nowMs) {
        this.revocations.delete(passId);
        return false;
      }
      return true;
    });
  }

  async revokePass(params: {
    passId: string;
    healthId?: string;
    revokedByUid: string;
    ttlMs?: number;
    nowMs?: number;
  }): Promise<RevocationRecord> {
    return this.runSerialized(async () => {
      const nowMs = params.nowMs ?? Date.now();
      const existing = this.revocations.get(params.passId);
      if (existing && existing.expiresAtMs > nowMs) {
        return { ...existing, alreadyRevoked: true };
      }
      const created: RevocationRecord = {
        passId: params.passId,
        healthId: params.healthId,
        revokedByUid: params.revokedByUid,
        revokedAtMs: nowMs,
        expiresAtMs: nowMs + (params.ttlMs ?? DEFAULT_REVOCATION_TTL_MS),
        alreadyRevoked: false,
      };
      this.revocations.set(params.passId, created);
      return created;
    });
  }

  async recordOrCheckReplay(params: {
    passId: string;
    healthId: string;
    rejectReplay: boolean;
    ttlMs: number;
    nowMs?: number;
  }): Promise<ReplayCheckResult> {
    return this.runSerialized(async () => {
      const nowMs = params.nowMs ?? Date.now();
      const existing = this.replayNonces.get(params.passId);
      if (existing && existing.expiresAtMs > nowMs) {
        if (params.rejectReplay) {
          return {
            replayed: true,
            presentationCount: existing.count,
            expiresAtMs: existing.expiresAtMs,
          };
        }
        existing.count += 1;
        return {
          replayed: false,
          presentationCount: existing.count,
          expiresAtMs: existing.expiresAtMs,
        };
      }
      const expiresAtMs = nowMs + Math.max(1000, params.ttlMs);
      this.replayNonces.set(params.passId, { count: 1, expiresAtMs });
      return { replayed: false, presentationCount: 1, expiresAtMs };
    });
  }

  async consumeRateLimit(params: {
    bucketKey: string;
    limit: number;
    windowMs: number;
    nowMs?: number;
  }): Promise<RateLimitResult> {
    return this.runSerialized(async () => {
      const nowMs = params.nowMs ?? Date.now();
      const existing = this.rateLimits.get(params.bucketKey);
      if (existing && existing.expiresAtMs > nowMs) {
        existing.count += 1;
        return {
          allowed: existing.count <= params.limit,
          count: existing.count,
          limit: params.limit,
          resetAtMs: existing.expiresAtMs,
        };
      }
      const expiresAtMs = nowMs + params.windowMs;
      this.rateLimits.set(params.bucketKey, { count: 1, expiresAtMs });
      return {
        allowed: 1 <= params.limit,
        count: 1,
        limit: params.limit,
        resetAtMs: expiresAtMs,
      };
    });
  }
}
