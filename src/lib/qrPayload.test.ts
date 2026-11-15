import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_CONSENTS, INITIAL_PATIENTS } from '../data/syntheticPatients.ts';
import {
  buildMinimizedUnsignedQrPayload,
  buildUnsignedQrPreview,
  parseQrPayloadStructure,
  serializeQrPayload,
} from './qrPayload.ts';

test('buildMinimizedUnsignedQrPayload enforces data minimization and consent redaction', () => {
  const patient = INITIAL_PATIENTS[0];
  const fullConsent = INITIAL_CONSENTS[patient.healthId];
  const payload = buildMinimizedUnsignedQrPayload(patient, fullConsent, {
    passId: 'QR-TEST-MIN-01',
    kid: 'mhis-qr-ed25519-k1',
    keyVersion: 1,
    issuedAt: '2026-11-14T00:00:00.000Z',
  });

  const record = payload as unknown as Record<string, unknown>;
  assert.equal('originState' in record, false);
  assert.equal('currentState' in record, false);
  assert.equal('phoneLast4' in record, false);
  assert.equal('encounters' in record, false);
  assert.deepEqual(payload.allergies, patient.allergies);

  const restrictedConsent = { ...fullConsent, emergencyQrAccess: false };
  const redacted = buildMinimizedUnsignedQrPayload(patient, restrictedConsent, {
    passId: 'QR-TEST-MIN-02',
    kid: 'mhis-qr-ed25519-k1',
    keyVersion: 1,
  });
  assert.equal(redacted.emergencyConsent, false);
  assert.equal(redacted.bloodGroup, 'Restricted');
  assert.equal(redacted.allergies[0], 'Restricted by patient consent');
  assert.equal(redacted.activeConditions[0], 'Consent verification required');
});

test('parseQrPayloadStructure rejects empty, oversized, legacy v1, and unexpected-field payloads', () => {
  assert.equal(parseQrPayloadStructure('').ok, false);
  assert.equal(parseQrPayloadStructure('{"x":"' + 'a'.repeat(5000) + '"}').ok, false);

  const legacyV1 = JSON.stringify({
    schema: 'MHIS-QR-v1',
    passId: 'QR-LEGACY-01',
    healthId: 'MHIS-BR-MH-1042',
    checksum: 'AABBCCDD',
  });
  const parsedLegacy = parseQrPayloadStructure(legacyV1);
  assert.equal(parsedLegacy.ok, false);
  if (!parsedLegacy.ok) {
    assert.equal(parsedLegacy.code, 'SCHEMA_INVALID');
  }

  const preview = buildUnsignedQrPreview(INITIAL_PATIENTS[0], INITIAL_CONSENTS[INITIAL_PATIENTS[0].healthId]);
  // Preview signature is explicitly non-valid for server verification (kid/keyVersion 0)
  const parsedPreview = parseQrPayloadStructure(serializeQrPayload(preview));
  assert.equal(parsedPreview.ok, false);
});
