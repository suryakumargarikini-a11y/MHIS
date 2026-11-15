import type { ConsentPreferences, MigrantPatient, QrHealthPassPayload } from '../types/health.ts';

export const QR_SCHEMA_VERSION = 'MHIS-QR-v2' as const;
export const DEFAULT_QR_TTL_DAYS = 14;
export const MAX_QR_RAW_BYTES = 4096;
export const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{3,64}$/;
export const SAFE_KID_REGEX = /^[a-zA-Z0-9._-]{3,64}$/;
export const ISO_TIMESTAMP_OR_DATE_REGEX =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/;

export type UnsignedQrHealthPassPayload = Omit<QrHealthPassPayload, 'signature'>;

export function addDaysIsoDate(baseIso: string, days: number): string {
  const normalized = baseIso.length === 10 ? `${baseIso}T00:00:00.000Z` : baseIso;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return baseIso;
  }
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString();
}

/**
 * Deterministic canonical byte-string signed and verified with Ed25519.
 * Covers every clinical, identity, consent, validity, and key-version field.
 */
export function canonicalizeQrPayload(payload: UnsignedQrHealthPassPayload): string {
  return JSON.stringify([
    payload.schema,
    payload.kid,
    payload.keyVersion,
    payload.passId,
    payload.healthId,
    payload.displayName,
    payload.bloodGroup,
    payload.primaryLanguage,
    payload.allergies,
    payload.activeConditions,
    payload.emergencyConsent,
    payload.issuedAt,
    payload.expiresAt,
  ]);
}

/**
 * Data-minimized emergency payload builder: omits origin/current state,
 * phone suffix, occupation, and longitudinal encounters from offline QR tokens.
 */
export function buildMinimizedUnsignedQrPayload(
  patient: MigrantPatient,
  consent: ConsentPreferences,
  options: {
    passId: string;
    kid: string;
    keyVersion: number;
    issuedAt?: string;
    expiresAt?: string;
    ttlDays?: number;
  },
): UnsignedQrHealthPassPayload {
  const issuedAt = options.issuedAt ?? new Date().toISOString();
  const ttlDays = options.ttlDays ?? DEFAULT_QR_TTL_DAYS;
  const expiresAt = options.expiresAt ?? addDaysIsoDate(issuedAt, ttlDays);
  const emergencyAllowed = consent.emergencyQrAccess;

  return {
    schema: QR_SCHEMA_VERSION,
    passId: options.passId,
    healthId: patient.healthId,
    displayName: patient.fullName.slice(0, 80),
    bloodGroup: emergencyAllowed ? patient.bloodGroup : 'Restricted',
    primaryLanguage: patient.primaryLanguage,
    allergies: emergencyAllowed ? patient.allergies.slice(0, 12) : ['Restricted by patient consent'],
    activeConditions: emergencyAllowed
      ? patient.chronicConditions.slice(0, 12)
      : ['Consent verification required'],
    emergencyConsent: emergencyAllowed,
    issuedAt,
    expiresAt,
    kid: options.kid,
    keyVersion: options.keyVersion,
  };
}

/**
 * Browser-safe unsigned preview ONLY for unauthenticated local UI display.
 * Never accepted by /api/qr/verify (which requires a server Ed25519 signature).
 */
export function buildUnsignedQrPreview(
  patient: MigrantPatient,
  consent: ConsentPreferences,
): QrHealthPassPayload {
  const unsigned = buildMinimizedUnsignedQrPayload(patient, consent, {
    passId: `PREVIEW-${patient.healthId.slice(-4)}`,
    kid: 'unauthenticated-preview',
    keyVersion: 0,
  });
  return {
    ...unsigned,
    signature: 'UNSIGNED_PREVIEW_SIGN_IN_FOR_ED25519',
  };
}

export function serializeQrPayload(payload: QrHealthPassPayload): string {
  return JSON.stringify(payload);
}

export type QrErrorCode =
  | 'EMPTY'
  | 'OVERSIZED'
  | 'INVALID_JSON'
  | 'SCHEMA_INVALID'
  | 'UNKNOWN_KID'
  | 'KEY_RETIRED'
  | 'SIGNATURE_INVALID'
  | 'EXPIRED'
  | 'NOT_YET_VALID'
  | 'REVOKED'
  | 'REPLAY_DETECTED';

export type QrStructureValidationResult =
  | { ok: true; payload: QrHealthPassPayload }
  | { ok: false; code: 'EMPTY' | 'OVERSIZED' | 'INVALID_JSON' | 'SCHEMA_INVALID'; error: string };

export function parseQrPayloadStructure(raw: string): QrStructureValidationResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      ok: false,
      code: 'EMPTY',
      error: 'QR payload is empty. Scan or paste an Ed25519-signed MHIS-QR-v2 payload.',
    };
  }

  if (Buffer.byteLength ? Buffer.byteLength(trimmed, 'utf8') > MAX_QR_RAW_BYTES : trimmed.length > MAX_QR_RAW_BYTES) {
    return {
      ok: false,
      code: 'OVERSIZED',
      error: `QR payload exceeds maximum permitted length (${MAX_QR_RAW_BYTES} bytes).`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      code: 'INVALID_JSON',
      error: 'Invalid QR format: expected MHIS-QR-v2 JSON payload.',
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, code: 'SCHEMA_INVALID', error: 'Malformed QR object.' };
  }

  const candidate = parsed as Partial<QrHealthPassPayload> & Record<string, unknown>;
  // Reject unexpected legacy or unminimized PHI fields
  const allowedKeys = new Set([
    'schema',
    'passId',
    'healthId',
    'displayName',
    'bloodGroup',
    'primaryLanguage',
    'allergies',
    'activeConditions',
    'emergencyConsent',
    'issuedAt',
    'expiresAt',
    'kid',
    'keyVersion',
    'signature',
  ]);
  for (const key of Object.keys(candidate)) {
    if (!allowedKeys.has(key)) {
      return {
        ok: false,
        code: 'SCHEMA_INVALID',
        error: `Unexpected field "${key}" in MHIS-QR-v2 payload.`,
      };
    }
  }

  if (
    candidate.schema !== QR_SCHEMA_VERSION ||
    typeof candidate.passId !== 'string' ||
    !SAFE_ID_REGEX.test(candidate.passId) ||
    typeof candidate.healthId !== 'string' ||
    !SAFE_ID_REGEX.test(candidate.healthId) ||
    typeof candidate.displayName !== 'string' ||
    candidate.displayName.length < 2 ||
    candidate.displayName.length > 80 ||
    typeof candidate.bloodGroup !== 'string' ||
    candidate.bloodGroup.length < 1 ||
    candidate.bloodGroup.length > 16 ||
    typeof candidate.primaryLanguage !== 'string' ||
    candidate.primaryLanguage.length < 2 ||
    candidate.primaryLanguage.length > 40 ||
    !Array.isArray(candidate.allergies) ||
    candidate.allergies.length > 12 ||
    !candidate.allergies.every((a) => typeof a === 'string' && a.length <= 100) ||
    !Array.isArray(candidate.activeConditions) ||
    candidate.activeConditions.length > 12 ||
    !candidate.activeConditions.every((c) => typeof c === 'string' && c.length <= 120) ||
    typeof candidate.emergencyConsent !== 'boolean' ||
    typeof candidate.issuedAt !== 'string' ||
    !ISO_TIMESTAMP_OR_DATE_REGEX.test(candidate.issuedAt) ||
    typeof candidate.expiresAt !== 'string' ||
    !ISO_TIMESTAMP_OR_DATE_REGEX.test(candidate.expiresAt) ||
    typeof candidate.kid !== 'string' ||
    !SAFE_KID_REGEX.test(candidate.kid) ||
    typeof candidate.keyVersion !== 'number' ||
    !Number.isInteger(candidate.keyVersion) ||
    candidate.keyVersion < 1 ||
    typeof candidate.signature !== 'string' ||
    !/^[A-Za-z0-9_-]{40,256}$/.test(candidate.signature)
  ) {
    return {
      ok: false,
      code: 'SCHEMA_INVALID',
      error: 'QR payload is missing required MHIS-QR-v2 cryptographic or clinical fields.',
    };
  }

  return { ok: true, payload: candidate as QrHealthPassPayload };
}
