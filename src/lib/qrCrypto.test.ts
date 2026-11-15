import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { INITIAL_CONSENTS, INITIAL_PATIENTS } from '../data/syntheticPatients.ts';
import { QrEd25519Keyring } from './qrCrypto.ts';
import { serializeQrPayload } from './qrPayload.ts';

test('Ed25519 QR signing & verification uses k2 active default, enforces k1 retirement, and supports k2->k3 rotation', () => {
  const keyring = new QrEd25519Keyring();
  const patient = INITIAL_PATIENTS[0];
  const consent = INITIAL_CONSENTS[patient.healthId];

  const issuedAt = '2026-11-14T10:00:00.000Z';
  const signedV2 = keyring.signPayload(patient, consent, {
    issuedAt,
    ttlDays: 14,
  });

  assert.equal(signedV2.schema, 'MHIS-QR-v2');
  assert.equal(signedV2.kid, 'mhis-qr-ed25519-k2');
  assert.equal(signedV2.keyVersion, 2);

  // Any legacy pass claiming compromised k1 must be rejected as KEY_RETIRED
  const legacyK1Attempt = serializeQrPayload({
    ...signedV2,
    kid: 'mhis-qr-ed25519-k1',
    keyVersion: 1,
  });
  const k1Rejected = keyring.verifyPayload(legacyK1Attempt, {
    nowMs: Date.parse('2026-11-15T10:00:00.000Z'),
  });
  assert.equal(k1Rejected.ok, false);
  if (!k1Rejected.ok) {
    assert.equal(k1Rejected.code, 'KEY_RETIRED');
  }

  const verifiedV2 = keyring.verifyPayload(serializeQrPayload(signedV2), {
    nowMs: Date.parse('2026-11-15T10:00:00.000Z'),
  });
  assert.equal(verifiedV2.ok, true);

  // Rotate to keyVersion 3 -> k2 remains verify_only and valid, new issuance uses k3
  const k3 = keyring.rotateKey('mhis-qr-ed25519-k3');
  assert.equal(k3.keyVersion, 3);

  const signedV3 = keyring.signPayload(patient, consent, { issuedAt, ttlDays: 14 });
  assert.equal(signedV3.kid, 'mhis-qr-ed25519-k3');
  assert.equal(signedV3.keyVersion, 3);

  const verifiedOldDuringRotation = keyring.verifyPayload(serializeQrPayload(signedV2), {
    nowMs: Date.parse('2026-11-15T10:00:00.000Z'),
  });
  assert.equal(verifiedOldDuringRotation.ok, true);

  // Retiring k2 invalidates tokens signed with k2 as KEY_RETIRED
  keyring.retireKey('mhis-qr-ed25519-k2');
  const retiredResult = keyring.verifyPayload(serializeQrPayload(signedV2), {
    nowMs: Date.parse('2026-11-15T10:00:00.000Z'),
  });
  assert.equal(retiredResult.ok, false);
  if (!retiredResult.ok) {
    assert.equal(retiredResult.code, 'KEY_RETIRED');
  }
});

test('Ed25519 QR verification rejects modified payload, forged signature, unknown kid, and expired signature', () => {
  const keyring = new QrEd25519Keyring();
  const patient = INITIAL_PATIENTS[1];
  const consent = INITIAL_CONSENTS[patient.healthId];

  const issuedAt = '2026-11-01T00:00:00.000Z';
  const signed = keyring.signPayload(patient, consent, { issuedAt, ttlDays: 7 });

  // 1. Modified payload
  const tamperedPayload = serializeQrPayload({ ...signed, bloodGroup: 'AB-' });
  const tamperedRes = keyring.verifyPayload(tamperedPayload, {
    nowMs: Date.parse('2026-11-02T00:00:00.000Z'),
  });
  assert.equal(tamperedRes.ok, false);
  if (!tamperedRes.ok) assert.equal(tamperedRes.code, 'SIGNATURE_INVALID');

  // 2. Forged signature from a rogue Ed25519 keypair claiming valid kid
  const roguePair = crypto.generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const forgedSig = crypto
    .sign(null, Buffer.from('forged', 'utf8'), roguePair.privateKey)
    .toString('base64url');
  const forgedRes = keyring.verifyPayload(serializeQrPayload({ ...signed, signature: forgedSig }), {
    nowMs: Date.parse('2026-11-02T00:00:00.000Z'),
  });
  assert.equal(forgedRes.ok, false);
  if (!forgedRes.ok) assert.equal(forgedRes.code, 'SIGNATURE_INVALID');

  // 3. Unknown kid
  const unknownKidRes = keyring.verifyPayload(
    serializeQrPayload({ ...signed, kid: 'unknown-attacker-key' }),
    { nowMs: Date.parse('2026-11-02T00:00:00.000Z') },
  );
  assert.equal(unknownKidRes.ok, false);
  if (!unknownKidRes.ok) assert.equal(unknownKidRes.code, 'UNKNOWN_KID');

  // 4. Expired pass
  const expiredRes = keyring.verifyPayload(serializeQrPayload(signed), {
    nowMs: Date.parse('2026-11-15T00:00:00.000Z'),
  });
  assert.equal(expiredRes.ok, false);
  if (!expiredRes.ok) assert.equal(expiredRes.code, 'EXPIRED');

  // 5. Future / not-yet-valid pass
  const futureRes = keyring.verifyPayload(serializeQrPayload(signed), {
    nowMs: Date.parse('2026-10-25T00:00:00.000Z'),
  });
  assert.equal(futureRes.ok, false);
  if (!futureRes.ok) assert.equal(futureRes.code, 'NOT_YET_VALID');
});

test('QrEd25519Keyring.fromEnvironment persists k2 across simulated restarts, blocks compromised k1, and omits privateKeyPem', () => {
  const prevJson = process.env.MHIS_QR_SIGNING_KEYS_JSON;
  const prevActive = process.env.MHIS_QR_ACTIVE_KID;

  try {
    const k1Retired = {
      kid: 'mhis-qr-ed25519-k1',
      keyVersion: 1,
      status: 'retired' as const,
      publicKeyPem: '',
      createdAt: '2026-11-14T00:00:00.000Z',
    };
    const k2 = QrEd25519Keyring.generateKeyPair('mhis-qr-ed25519-k2', 2, 'active');
    const patient = INITIAL_PATIENTS[0];
    const consent = INITIAL_CONSENTS[patient.healthId];
    const issuedAt = '2026-11-14T10:00:00.000Z';

    // Compromised k1 CANNOT be loaded as active or verify_only
    const rogueK1 = QrEd25519Keyring.generateKeyPair('mhis-qr-ed25519-k1', 1, 'verify_only');
    process.env.MHIS_QR_ACTIVE_KID = 'mhis-qr-ed25519-k2';
    process.env.MHIS_QR_SIGNING_KEYS_JSON = JSON.stringify([rogueK1, k2]);
    assert.throws(() => QrEd25519Keyring.fromEnvironment(), /Compromised signing key/);

    // Simulate process 1 issuing with k2 while k1 is retired
    process.env.MHIS_QR_ACTIVE_KID = 'mhis-qr-ed25519-k2';
    process.env.MHIS_QR_SIGNING_KEYS_JSON = JSON.stringify([k1Retired, k2]);
    const boot1 = QrEd25519Keyring.fromEnvironment();
    const passFromBoot1 = boot1.signPayload(patient, consent, { issuedAt, ttlDays: 14 });

    // Simulate process 2 restart with same env keyring (and subsequent rotation to k3)
    const k3 = QrEd25519Keyring.generateKeyPair('mhis-qr-ed25519-k3', 3, 'active');
    process.env.MHIS_QR_ACTIVE_KID = 'mhis-qr-ed25519-k3';
    process.env.MHIS_QR_SIGNING_KEYS_JSON = JSON.stringify([
      k1Retired,
      { ...k2, status: 'verify_only', privateKeyPem: undefined },
      k3,
    ]);
    const boot2 = QrEd25519Keyring.fromEnvironment();

    assert.equal(boot2.getActiveKey().kid, 'mhis-qr-ed25519-k3');
    const verifiedAfterRestart = boot2.verifyPayload(serializeQrPayload(passFromBoot1), {
      nowMs: Date.parse('2026-11-15T10:00:00.000Z'),
    });
    assert.equal(verifiedAfterRestart.ok, true);

    // Public metadata API projection must NEVER expose privateKeyPem
    const pubMeta = boot2.listPublicMetadata();
    assert.equal(pubMeta.length, 3);
    for (const item of pubMeta) {
      assert.equal('privateKeyPem' in item, false);
    }

    // Mismatched public/private key fails loudly on startup
    process.env.MHIS_QR_ACTIVE_KID = 'mhis-qr-ed25519-k3';
    process.env.MHIS_QR_SIGNING_KEYS_JSON = JSON.stringify([
      { ...k3, publicKeyPem: k2.publicKeyPem },
    ]);
    assert.throws(() => QrEd25519Keyring.fromEnvironment(), /does not match publicKeyPem/);

    // Invalid activeKid fails loudly on startup
    process.env.MHIS_QR_ACTIVE_KID = 'missing-kid';
    process.env.MHIS_QR_SIGNING_KEYS_JSON = JSON.stringify([k3]);
    assert.throws(() => QrEd25519Keyring.fromEnvironment(), /not found in keyring/);
  } finally {
    if (prevJson === undefined) delete process.env.MHIS_QR_SIGNING_KEYS_JSON;
    else process.env.MHIS_QR_SIGNING_KEYS_JSON = prevJson;
    if (prevActive === undefined) delete process.env.MHIS_QR_ACTIVE_KID;
    else process.env.MHIS_QR_ACTIVE_KID = prevActive;
  }
});
