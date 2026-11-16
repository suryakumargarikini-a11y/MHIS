# PHASE 5.6: Vercel Deployment Architecture & Verification Report

**Project:** Migrant Health Intelligence System (SIH25083)  
**Target Host:** Vercel (Static Vite SPA CDN + Node.js Serverless API Functions)  
**Firebase Project:** `mhis-40ff1`  
**Named Firestore Database:** `ai-studio-85830e53-0349-481d-ae27-ffdfdecbe5c5` (never `(default)`)  
**Gemini Models:** `gemini-4-hydrogen` (`GEMINI_GENERATION_MODEL`) & `gemini-embedding-2` (`GEMINI_EMBEDDING_MODEL`)

---

## 1. Executive Status & Honest Blockers

All codebase refactoring, Vercel serverless entrypoints, Firebase credential support, environment configuration, security hardening, TypeScript compilation, Vite bundling, local runtime verification, and automated tests (**51/51 passing**) are complete.

**Live Remote Vercel Preview Deployment Blocked in Sandbox Environment:**
- `vercel` CLI is not installed in this container (`vercel: not found`).
- No `VERCEL_TOKEN`, `VERCEL_ORG_ID`, or `VERCEL_PROJECT_ID` secrets are present in the container environment.
- The workspace is not initialized with a remote Git repository (`git remote` unavailable).
- `FIREBASE_SERVICE_ACCOUNT_JSON` is not present in the container environment.

No deployment URL or remote test results have been fabricated. Follow **Section 6** below from an authenticated workstation or Git-linked Vercel project to complete the live Preview deployment and remote end-to-end checks.

---

## 2. Vercel Deployment Architecture

| Layer | File(s) | Behavior on Vercel | Local AI Studio Parity |
| :--- | :--- | :--- | :--- |
| **Frontend Static Build** | `vercel.json`, `vite.config.ts`, `src/lib/firebase.ts` | `npm run build` emits Vite SPA into `dist/`; served via Vercel Edge CDN. | `tsx server.ts` mounts `vite.middlewares` on port `3000`. |
| **Serverless API Adapter** | `api/index.ts`, `server.ts` | `/api/(.*)` rewrites to `api/index.ts`, which lazily initializes & caches `createApp()` across warm invocations (`maxDuration: 60`) without calling `app.listen()`. | Direct execution runs `app.listen(PORT, '0.0.0.0')`. |
| **SPA Fallback Routing** | `vercel.json` | `/((?!api/).*)` rewrites client routes to `/index.html` without intercepting `/api/*`. | Express fallback handles SPA routes. |
| **Build Context Exclusions** | `.vercelignore` | Excludes `.env*` (except `.env.example`), `node_modules`, `dist`, `.aistudio`, `.playwright-cli`, and `*.log` while retaining `firebase-applet-config.json`. | N/A |

---

## 3. Firebase & Gemini Integration Readiness

### Client SDK (`src/lib/firebase.ts`)
- Reads `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_FIRESTORE_DATABASE_ID`, and `VITE_FIREBASE_MEASUREMENT_ID`.
- Falls back cleanly to `firebase-applet-config.json` (`mhis-40ff1` and named database `ai-studio-85830e53-0349-481d-ae27-ffdfdecbe5c5`).

### Admin SDK (`src/lib/firebaseAdminAuth.ts`)
- Added `parseFirebaseServiceAccountFromEnv()` supporting raw JSON or base64-encoded JSON in `FIREBASE_SERVICE_ACCOUNT_JSON` (normalizing escaped `\\n` in `private_key` without logging secret material).
- `getFirebaseAdminApp()` initializes with `cert(serviceAccount)` when `FIREBASE_SERVICE_ACCOUNT_JSON` is configured on Vercel, falling back to Application Default Credentials when absent.
- `loadFirebaseAppletConfig()` supports `GOOGLE_CLOUD_PROJECT` / `FIREBASE_PROJECT_ID` and `FIRESTORE_DATABASE_ID`, strictly rejecting `"(default)"` and preserving `ai-studio-85830e53-0349-481d-ae27-ffdfdecbe5c5`.

### Gemini Models & Timeouts (`server.ts`, `src/lib/pretrainedEmbeddings.ts`, `api/index.ts`)
- `getConfiguredGenerationModel()` resolves `GEMINI_GENERATION_MODEL` (default: `gemini-4-hydrogen`).
- `getConfiguredEmbeddingModel()` resolves `GEMINI_EMBEDDING_MODEL` (default: `gemini-embedding-2`).
- `GEMINI_TIMEOUT_MS` remains `35000` ms, aligned with `maxDuration: 60` configured in both `api/index.ts` and `vercel.json`.

---

## 4. Security Hardening Summary

1. **Strict Origin & CORS Allowlist (`server.ts`):**
   - `resolveAllowedOrigins()` trusts `http://localhost:3000`, `APP_URL`, `VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL`, `ALLOWED_ORIGINS`, and same-host headers (`X-Forwarded-Host` / `Host`).
   - Wildcard `Access-Control-Allow-Origin: *` is never emitted on `/api/*`.
   - Requests from untrusted browser `Origin` headers to `/api/*` fail closed with HTTP `403` (`CORS_ORIGIN_FORBIDDEN`).
2. **Proxy-Aware Distributed Rate Limiting (`server.ts`, `src/lib/distributedSecurityStore.ts`):**
   - `app.set('trust proxy', 1)` ensures `req.ip` resolves the real client IP behind Vercel edge proxies for Firestore ACID rate-limit buckets (`ip_${clientIp}`).
3. **Stateless Multi-Instance Ed25519 QR Enforcement (`src/lib/qrCrypto.ts`):**
   - Active key remains `mhis-qr-ed25519-k2` (`keyVersion: 2`); `mhis-qr-ed25519-k1` remains permanently `retired`.
   - On Vercel (`VERCEL` or `VERCEL_ENV` set outside tests), `QrEd25519Keyring.fromEnvironment()` fails closed if `MHIS_QR_SIGNING_KEYS_JSON` is missing so independent serverless instances never sign/verify with incompatible ephemeral keys.
   - Replay nonces and pass revocations remain persisted in Firestore transactions (`qrRevocations`, `qrReplayNonces`).
4. **Zero-Trust Auth & Rules:**
   - Firebase ID Token verification (`checkRevoked: true`) and authoritative Firestore role resolution remain enforced server-side on all PHI, AI, audit, and QR routes.

---

## 5. Required Vercel Environment Variables (Preview & Production)

Configure these in **Vercel Project Settings -> Environment Variables** (documented without secrets in `.env.example`):

| Variable | Scope | Value / Notes |
| :--- | :--- | :--- |
| `VITE_FIREBASE_API_KEY` | Client (Build) | Web API key for `mhis-40ff1` |
| `VITE_FIREBASE_AUTH_DOMAIN` | Client (Build) | `mhis-40ff1.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | Client (Build) | `mhis-40ff1` |
| `VITE_FIREBASE_APP_ID` | Client (Build) | Firebase Web App ID |
| `VITE_FIREBASE_FIRESTORE_DATABASE_ID` | Client (Build) | `ai-studio-85830e53-0349-481d-ae27-ffdfdecbe5c5` |
| `GEMINI_API_KEY` | Server (Encrypted) | Server-side Gemini API key (never prefixed with `VITE_`) |
| `GEMINI_GENERATION_MODEL` | Server | `gemini-4-hydrogen` |
| `GEMINI_EMBEDDING_MODEL` | Server | `gemini-embedding-2` |
| `GOOGLE_CLOUD_PROJECT` | Server | `mhis-40ff1` |
| `FIRESTORE_DATABASE_ID` | Server | `ai-studio-85830e53-0349-481d-ae27-ffdfdecbe5c5` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Server (Encrypted) | GCP Service Account JSON (or base64 JSON) for `mhis-40ff1` |
| `MHIS_QR_ACTIVE_KID` | Server | `mhis-qr-ed25519-k2` |
| `MHIS_QR_SIGNING_KEYS_JSON` | Server (Encrypted) | JSON array with `k1` (`retired`) & `k2` (`active` private+public PEM) |
| `ALLOWED_ORIGINS` | Server | Optional comma-separated custom domain origins |

---

## 6. Automated & Local Verification Results (Verified in Workspace)

- **Automated Test Suite (`NODE_ENV=test npx --yes tsx --test src/lib/*.test.ts`):** **51/51 passed** (`0` failed), covering:
  - QR compromise remediation (`k1` retired, `k2` active), multi-instance verification, atomic replay defense, and Vercel missing-secret fail-closed check.
  - Clinical RAG grounding, Q08 medication cessation, Q47 missing-lab abstention, OOV-02, and consent metadata masking.
  - Firebase Admin `mhis-40ff1` / `ai-studio-85830e53-0349-481d-ae27-ffdfdecbe5c5` configuration and Service Account parser.
  - `api/index.ts` serverless handler export (`config.maxDuration === 60`), strict CORS (`403` on untrusted `Origin`, exact origin echo on trusted origin, `204` preflight), and Gemini model env resolution.
- **TypeScript Lint (`npm run lint` / `tsc --noEmit`):** **Passed (exit code 0)**.
- **Production Frontend Build (`npm run build` / `vite build`):** **Succeeded**.
- **Local Server & Headless Chromium Verification (`http://localhost:3000`):**
  - `GET /api/health` returned `200 OK` with `"geminiConfigured": true`, `"activeKid": "mhis-qr-ed25519-k2"`, `"keyVersion": 2`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`.
  - Cross-origin `Origin: https://evil.example` rejected with `403 CORS_ORIGIN_FORBIDDEN`; `Origin: http://localhost:3000` allowed with exact `Access-Control-Allow-Origin`.
  - Chromium rendered all 5 workspace controls (`k-Anonymity Surveillance`, `Identity Resolution`, `Clinician RAG`, `Ed25519 Health Pass`, `Consent Governance`) and surveillance ledger cleanly with zero application errors.

---

## 7. Next Steps to Complete Live Preview Deployment

1. Push repository to GitHub/GitLab or run `npx vercel` locally with an authenticated Vercel account (`vercel login`).
2. Add the encrypted environment variables from **Section 5** to the Vercel **Preview** environment (including `FIREBASE_SERVICE_ACCOUNT_JSON` and `MHIS_QR_SIGNING_KEYS_JSON`).
3. Create the **Preview** deployment first (`vercel deploy`, without `--prod`).
4. Add the generated `*.vercel.app` preview domain to **Firebase Console -> Authentication -> Settings -> Authorized domains** for project `mhis-40ff1`.
5. Run live Preview verification against the deployed `https://<preview>.vercel.app` URL:
   - `GET /api/health` -> `200 OK`
   - Unauthenticated `GET /api/patients` -> `401 MISSING_TOKEN`
   - Google Sign-In + Firestore reads/writes against `ai-studio-85830e53-0349-481d-ae27-ffdfdecbe5c5`
   - Live Gemini RAG query (`/api/ai/assistant`) returning `model: "gemini-4-hydrogen"` and valid `[ENC-...]` citations
   - Ed25519 QR Health Pass issuance, verification, and replay protection (`QR_REPLAY_DETECTED`) across cold starts
   - SPA hard refresh on non-root routes verifying `/index.html` fallback works cleanly.
