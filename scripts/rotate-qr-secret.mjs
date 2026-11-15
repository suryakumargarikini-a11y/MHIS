#!/usr/bin/env node
/**
 * Controlled Ed25519 QR Keyring Rotation Utility for Google Cloud Secret Manager.
 * Security invariants:
 * - Generates keyVersion=2 (kid: mhis-qr-ed25519-k2) locally using Node.js crypto.
 * - Marks compromised key mhis-qr-ed25519-k1 strictly as "retired" with NO privateKeyPem.
 * - NEVER prints privateKeyPem to stdout, stderr, logs, or workspace files.
 * - When invoked with `--upload-gcloud --project=<PROJECT_ID>`, pipes JSON via stdin
 *   directly into `gcloud secrets versions add` without writing plaintext secrets to disk.
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const uploadGcloud = args.includes('--upload-gcloud');
const projectArg = args.find((a) => a.startsWith('--project='))?.split('=')[1] || 'magnificent-hydra-r9v0l';
const secretName = args.find((a) => a.startsWith('--secret='))?.split('=')[1] || 'MHIS_QR_SIGNING_KEYS_JSON';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// Self-verify generated keypair in memory before any secret upload
const probe = Buffer.from('mhis-qr-ed25519-k2:self-check', 'utf8');
const signature = crypto.sign(null, probe, privateKey);
if (!crypto.verify(null, probe, publicKey, signature)) {
  console.error('FATAL: Newly generated Ed25519 key pair failed cryptographic self-verification.');
  process.exit(1);
}

const keyringPayload = JSON.stringify([
  {
    kid: 'mhis-qr-ed25519-k1',
    keyVersion: 1,
    status: 'retired',
    publicKeyPem: '',
    createdAt: '2026-11-14T00:00:00.000Z',
  },
  {
    kid: 'mhis-qr-ed25519-k2',
    keyVersion: 2,
    status: 'active',
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
    createdAt: new Date().toISOString(),
  },
]);

const fingerprint = crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 16);

if (uploadGcloud) {
  execFileSync(
    'gcloud',
    ['secrets', 'versions', 'add', secretName, '--project', projectArg, '--data-file=-'],
    { input: keyringPayload, stdio: ['pipe', 'inherit', 'inherit'] },
  );
  console.log(
    JSON.stringify({
      uploaded: true,
      project: projectArg,
      secretName,
      activeKid: 'mhis-qr-ed25519-k2',
      retiredKids: ['mhis-qr-ed25519-k1'],
      publicKeySha256_16: fingerprint,
    }),
  );
} else {
  console.log(
    JSON.stringify({
      uploaded: false,
      mode: 'dry-run-verified',
      activeKid: 'mhis-qr-ed25519-k2',
      keyVersion: 2,
      retiredKids: ['mhis-qr-ed25519-k1'],
      publicKeySha256_16: fingerprint,
      note: 'Private key intentionally withheld from terminal output and files. Pass --upload-gcloud --project=<ID> in authenticated Cloud Shell.',
    }),
  );
}
