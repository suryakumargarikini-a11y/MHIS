import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SecurityStoreUnavailableError,
  TestSharedSecurityStore,
} from './distributedSecurityStore.ts';

test('Distributed security store enforces idempotent revocation and TTL expiration', async () => {
  const store = new TestSharedSecurityStore();
  const t0 = 1_700_000_000_000;

  const first = await store.revokePass({
    passId: 'QR-REV-001',
    healthId: 'MHIS-BR-MH-1042',
    revokedByUid: 'uid-patient-1',
    ttlMs: 5000,
    nowMs: t0,
  });
  assert.equal(first.alreadyRevoked, false);

  const second = await store.revokePass({
    passId: 'QR-REV-001',
    healthId: 'MHIS-BR-MH-1042',
    revokedByUid: 'uid-patient-1',
    ttlMs: 5000,
    nowMs: t0 + 1000,
  });
  assert.equal(second.alreadyRevoked, true);
  assert.equal(second.revokedAtMs, t0);

  assert.equal(await store.isPassRevoked('QR-REV-001', t0 + 2000), true);
  assert.equal(await store.isPassRevoked('QR-REV-001', t0 + 6000), false);
});

test('Atomic replay protection permits strictly 1 of 10 concurrent verifications', async () => {
  const store = new TestSharedSecurityStore();
  const t0 = 1_700_000_000_000;

  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      store.recordOrCheckReplay({
        passId: 'QR-RACE-999',
        healthId: 'MHIS-BR-MH-1042',
        rejectReplay: true,
        ttlMs: 60_000,
        nowMs: t0,
      }),
    ),
  );

  const accepted = results.filter((r) => !r.replayed);
  const rejected = results.filter((r) => r.replayed);
  assert.equal(accepted.length, 1);
  assert.equal(rejected.length, 9);

  // After TTL expires, nonce expires cleanly
  const afterExpiry = await store.recordOrCheckReplay({
    passId: 'QR-RACE-999',
    healthId: 'MHIS-BR-MH-1042',
    rejectReplay: true,
    ttlMs: 60_000,
    nowMs: t0 + 61_000,
  });
  assert.equal(afterExpiry.replayed, false);
});

test('Distributed rate limiter enforces cross-window limits and TTL resets', async () => {
  const store = new TestSharedSecurityStore();
  const t0 = 1_700_000_000_000;

  const checks = await Promise.all(
    Array.from({ length: 5 }, () =>
      store.consumeRateLimit({
        bucketKey: 'ip:10.0.0.1',
        limit: 3,
        windowMs: 60_000,
        nowMs: t0,
      }),
    ),
  );

  assert.equal(checks.filter((c) => c.allowed).length, 3);
  assert.equal(checks.filter((c) => !c.allowed).length, 2);

  const afterWindow = await store.consumeRateLimit({
    bucketKey: 'ip:10.0.0.1',
    limit: 3,
    windowMs: 60_000,
    nowMs: t0 + 61_000,
  });
  assert.equal(afterWindow.allowed, true);
  assert.equal(afterWindow.count, 1);
});

test('Distributed security store fails closed when database is unavailable', async () => {
  const store = new TestSharedSecurityStore();
  store.simulateOutage = true;

  await assert.rejects(
    () => store.isPassRevoked('QR-ANY'),
    (err: unknown) => err instanceof SecurityStoreUnavailableError,
  );
  await assert.rejects(
    () =>
      store.recordOrCheckReplay({
        passId: 'QR-ANY',
        healthId: 'MHIS-BR-MH-1042',
        rejectReplay: true,
        ttlMs: 1000,
      }),
    (err: unknown) => err instanceof SecurityStoreUnavailableError,
  );
});
