import crypto from 'node:crypto';
import type { ConsentPreferences, MigrantPatient, QrHealthPassPayload } from '../types/health.ts';
import {
  buildMinimizedUnsignedQrPayload,
  canonicalizeQrPayload,
  parseQrPayloadStructure,
  type QrErrorCode,
} from './qrPayload.ts';

export type QrKeyStatus = 'active' | 'verify_only' | 'retired';

export interface QrSigningKeyRecord {
  kid: string;
  keyVersion: number;
  status: QrKeyStatus;
  privateKeyPem?: string;
  publicKeyPem: string;
  createdAt: string;
}

interface ParsedEnvKeyEntry {
  kid: string;
  keyVersion: number;
  status?: QrKeyStatus;
  privateKeyPem?: string;
  publicKeyPem: string;
  createdAt?: string;
}

export type QrCryptoVerifyResult =
  | {
      ok: true;
      payload: QrHealthPassPayload;
      warnings?: string[];
    }
  | {
      ok: false;
      code: QrErrorCode;
      error: string;
    };

function normalizeDateBound(value: string, endOfDayIfDateOnly: boolean): number {
  if (value.length === 10) {
    return Date.parse(`${value}T${endOfDayIfDateOnly ? '23:59:59.999' : '00:00:00.000'}Z`);
  }
  return Date.parse(value);
}

export const COMPROMISED_QR_KIDS = new Set<string>(['mhis-qr-ed25519-k1']);

/**
 * Server-side Ed25519 Keyring supporting key IDs (`kid`), monotonic `keyVersion`,
 * online key rotation (keeping older non-retired keys in `verify_only` state),
 * and immediate key retirement. Private keys never leave the server process.
 */
export class QrEd25519Keyring {
  private keys = new Map<string, QrSigningKeyRecord>();
  private activeKid: string;

  constructor(initialKeys?: QrSigningKeyRecord[], activeKid?: string) {
    if (initialKeys && initialKeys.length > 0) {
      for (const entry of initialKeys) {
        if (!entry.kid || typeof entry.kid !== 'string') {
          throw new Error('Every QR key entry must define a non-empty kid.');
        }
        if (!Number.isInteger(entry.keyVersion) || entry.keyVersion < 1) {
          throw new Error(`QR key "${entry.kid}" must have a positive integer keyVersion.`);
        }
        if (COMPROMISED_QR_KIDS.has(entry.kid) && entry.status !== 'retired') {
          throw new Error(
            `Compromised signing key "${entry.kid}" must have status "retired" and cannot be active or verify_only.`,
          );
        }
        if (entry.status !== 'retired') {
          const pubObj = crypto.createPublicKey(entry.publicKeyPem);
          if (pubObj.asymmetricKeyType !== 'ed25519') {
            throw new Error(`QR key "${entry.kid}" publicKeyPem is not an Ed25519 key.`);
          }
          if (entry.privateKeyPem) {
            const privObj = crypto.createPrivateKey(entry.privateKeyPem);
            if (privObj.asymmetricKeyType !== 'ed25519') {
              throw new Error(`QR key "${entry.kid}" privateKeyPem is not an Ed25519 key.`);
            }
            const probe = Buffer.from(`mhis-key-selftest:${entry.kid}`, 'utf8');
            const sig = crypto.sign(null, probe, privObj);
            if (!crypto.verify(null, probe, pubObj, sig)) {
              throw new Error(`QR key "${entry.kid}" privateKeyPem does not match publicKeyPem.`);
            }
          }
          this.keys.set(entry.kid, entry);
        } else {
          // Never retain privateKeyPem for retired/compromised keys
          this.keys.set(entry.kid, {
            kid: entry.kid,
            keyVersion: entry.keyVersion,
            status: 'retired',
            publicKeyPem: '',
            createdAt: entry.createdAt,
          });
        }
      }

      if (activeKid) {
        const explicit = this.keys.get(activeKid);
        if (!explicit) {
          throw new Error(`Configured MHIS_QR_ACTIVE_KID "${activeKid}" was not found in keyring.`);
        }
        if (explicit.status !== 'active' || !explicit.privateKeyPem) {
          throw new Error(
            `Configured MHIS_QR_ACTIVE_KID "${activeKid}" must have status "active" and privateKeyPem.`,
          );
        }
        this.activeKid = explicit.kid;
        return;
      }

      const chosenActive = initialKeys.find((k) => k.status === 'active' && Boolean(k.privateKeyPem));
      if (!chosenActive) {
        throw new Error('QrEd25519Keyring requires at least one active signing key with privateKeyPem.');
      }
      this.activeKid = chosenActive.kid;
      return;
    }

    const retiredK1: QrSigningKeyRecord = {
      kid: 'mhis-qr-ed25519-k1',
      keyVersion: 1,
      status: 'retired',
      publicKeyPem: '',
      createdAt: '2026-11-14T00:00:00.000Z',
    };
    const generatedK2 = QrEd25519Keyring.generateKeyPair('mhis-qr-ed25519-k2', 2, 'active');
    this.keys.set(retiredK1.kid, retiredK1);
    this.keys.set(generatedK2.kid, generatedK2);
    this.activeKid = generatedK2.kid;
  }

  static generateKeyPair(
    kid: string,
    keyVersion: number,
    status: QrKeyStatus = 'active',
  ): QrSigningKeyRecord {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return {
      kid,
      keyVersion,
      status,
      privateKeyPem: privateKey,
      publicKeyPem: publicKey,
      createdAt: new Date().toISOString(),
    };
  }

  static fromEnvironment(options?: { requirePersistentKeys?: boolean }): QrEd25519Keyring {
    const rawJson = process.env.MHIS_QR_SIGNING_KEYS_JSON?.trim();
    const activeKidEnv = process.env.MHIS_QR_ACTIVE_KID?.trim() || undefined;
    const isVercelRuntime = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
    const requirePersistent =
      options?.requirePersistentKeys ?? (isVercelRuntime && process.env.NODE_ENV !== 'test');

    if (!rawJson) {
      if (requirePersistent) {
        throw new Error(
          'MHIS_QR_SIGNING_KEYS_JSON must be configured in serverless/Vercel environments so Ed25519 signatures verify across independent instances.',
        );
      }
      return new QrEd25519Keyring();
    }

    let parsed: ParsedEnvKeyEntry[];
    try {
      parsed = JSON.parse(rawJson) as ParsedEnvKeyEntry[];
    } catch (err) {
      throw new Error(
        `MHIS_QR_SIGNING_KEYS_JSON is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('MHIS_QR_SIGNING_KEYS_JSON must be a non-empty JSON array.');
    }

    const records: QrSigningKeyRecord[] = parsed.map((entry) => ({
      kid: entry.kid,
      keyVersion: entry.keyVersion,
      status: entry.status ?? 'active',
      privateKeyPem: entry.privateKeyPem,
      publicKeyPem: entry.publicKeyPem,
      createdAt: entry.createdAt ?? new Date().toISOString(),
    }));
    return new QrEd25519Keyring(records, activeKidEnv);
  }

  getActiveKey(): QrSigningKeyRecord {
    const key = this.keys.get(this.activeKid);
    if (!key || key.status !== 'active' || !key.privateKeyPem) {
      throw new Error('Active Ed25519 QR signing key is unavailable.');
    }
    return key;
  }

  getKeyForVerification(kid: string): QrSigningKeyRecord | null {
    const key = this.keys.get(kid);
    if (!key || key.status === 'retired' || COMPROMISED_QR_KIDS.has(kid)) {
      return null;
    }
    return key;
  }

  isKeyRetired(kid: string): boolean {
    if (COMPROMISED_QR_KIDS.has(kid)) return true;
    return this.keys.get(kid)?.status === 'retired';
  }

  listPublicMetadata(): Array<Omit<QrSigningKeyRecord, 'privateKeyPem'>> {
    return Array.from(this.keys.values()).map(({ privateKeyPem: _omit, ...pub }) => pub);
  }

  rotateKey(nextKid?: string): QrSigningKeyRecord {
    const current = this.getActiveKey();
    this.keys.set(current.kid, {
      ...current,
      status: 'verify_only',
    });

    const nextVersion =
      Math.max(...Array.from(this.keys.values()).map((k) => k.keyVersion), 0) + 1;
    const newKid = nextKid ?? `mhis-qr-ed25519-k${nextVersion}`;
    const generated = QrEd25519Keyring.generateKeyPair(newKid, nextVersion, 'active');
    this.keys.set(generated.kid, generated);
    this.activeKid = generated.kid;
    return generated;
  }

  retireKey(kid: string): void {
    const existing = this.keys.get(kid);
    if (!existing) return;
    if (kid === this.activeKid) {
      throw new Error('Rotate to a new active signing key before retiring the current active key.');
    }
    this.keys.set(kid, {
      ...existing,
      status: 'retired',
      privateKeyPem: undefined,
    });
  }

  signPayload(
    patient: MigrantPatient,
    consent: ConsentPreferences,
    options?: {
      passId?: string;
      issuedAt?: string;
      expiresAt?: string;
      ttlDays?: number;
    },
  ): QrHealthPassPayload {
    const active = this.getActiveKey();
    const randomSuffix = crypto.randomBytes(8).toString('hex').toUpperCase();
    const passId = options?.passId ?? `QR-${patient.healthId.slice(-4)}-${randomSuffix}`;

    const unsigned = buildMinimizedUnsignedQrPayload(patient, consent, {
      passId,
      kid: active.kid,
      keyVersion: active.keyVersion,
      issuedAt: options?.issuedAt,
      expiresAt: options?.expiresAt,
      ttlDays: options?.ttlDays,
    });

    const canonicalBytes = Buffer.from(canonicalizeQrPayload(unsigned), 'utf8');
    const signature = crypto
      .sign(null, canonicalBytes, active.privateKeyPem!)
      .toString('base64url');

    return {
      ...unsigned,
      signature,
    };
  }

  verifyPayload(
    rawPayload: string,
    options?: {
      nowMs?: number;
    },
  ): QrCryptoVerifyResult {
    const structural = parseQrPayloadStructure(rawPayload);
    if (!structural.ok) {
      return structural;
    }

    const payload = structural.payload;
    const keyRecord = this.getKeyForVerification(payload.kid);
    if (!keyRecord) {
      if (this.isKeyRetired(payload.kid)) {
        return {
          ok: false,
          code: 'KEY_RETIRED',
          error: `QR signing key (${payload.kid}) has been retired due to key rotation or compromise remediation. Controlled QR reissuance is required.`,
        };
      }
      return {
        ok: false,
        code: 'UNKNOWN_KID',
        error: `Unknown QR signing key identifier (${payload.kid}).`,
      };
    }

    if (payload.keyVersion !== keyRecord.keyVersion) {
      return {
        ok: false,
        code: 'SIGNATURE_INVALID',
        error: `QR keyVersion (${payload.keyVersion}) does not match key ${payload.kid} version (${keyRecord.keyVersion}).`,
      };
    }

    const { signature, ...unsigned } = payload;
    const canonicalBytes = Buffer.from(canonicalizeQrPayload(unsigned), 'utf8');

    let sigBytes: Buffer;
    try {
      sigBytes = Buffer.from(signature, 'base64url');
    } catch {
      return {
        ok: false,
        code: 'SIGNATURE_INVALID',
        error: 'Malformed Ed25519 signature encoding.',
      };
    }

    let validSignature = false;
    try {
      validSignature = crypto.verify(null, canonicalBytes, keyRecord.publicKeyPem, sigBytes);
    } catch {
      validSignature = false;
    }

    if (!validSignature) {
      return {
        ok: false,
        code: 'SIGNATURE_INVALID',
        error: 'Ed25519 digital signature verification failed (payload tampered or forged).',
      };
    }

    const nowMs = options?.nowMs ?? Date.now();
    const issuedMs = normalizeDateBound(payload.issuedAt, false);
    const expiresMs = normalizeDateBound(payload.expiresAt, true);

    if (Number.isNaN(issuedMs) || Number.isNaN(expiresMs) || expiresMs < issuedMs) {
      return {
        ok: false,
        code: 'SCHEMA_INVALID',
        error: 'Invalid QR pass validity timestamps.',
      };
    }

    if (nowMs < issuedMs) {
      return {
        ok: false,
        code: 'NOT_YET_VALID',
        error: `QR Health Pass is not valid until ${payload.issuedAt}.`,
      };
    }

    if (nowMs > expiresMs) {
      return {
        ok: false,
        code: 'EXPIRED',
        error: `QR Health Pass expired on ${payload.expiresAt}. Request a fresh pass from the server.`,
      };
    }

    return { ok: true, payload };
  }
}
