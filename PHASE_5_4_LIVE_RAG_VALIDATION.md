# PHASE 5.4: LIVE STAGING RAG VALIDATION AND INDEPENDENT EVIDENCE AUDIT

**System:** Migrant Health Intelligence System (SIH25083)  
**Audit Date:** 2026-11-15  
**Target Environment:** Local Dev Server (`http://localhost:3000`) & Cloud Run Dev Staging (`https://ais-dev-ezak6fdtw66iajpadr6wup-204913994787.asia-southeast1.run.app`)  
**Production Deployment:** NOT EXECUTED (per Phase 5.4 freeze; validation-only audit)

---

## 1. Executive Summary & Audit Classification

| Audit Workstream | Classification | Observed Status | Ratio / Result |
| :--- | :--- | :--- | :--- |
| Staging Preflight & Health Probe (`localhost:3000/api/health`) | Live Staging Probe | **PASSED** (HTTP 200) | `geminiConfigured: true`, `activeKid: mhis-qr-ed25519-k2` (v2) |
| Fail-Closed Auth Gates (`localhost:3000/api/*`) | Live Staging Probe | **PASSED** (HTTP 401) | `7/7` unauthenticated/forged probes rejected |
| Direct Firestore & Firebase Admin Auth Staging Access | Live Staging Probe | **BLOCKED** | `7 PERMISSION_DENIED` (Firestore) / `auth/internal-error` (Identity Toolkit) |
| Live 30-Query Authenticated Gemini RAG (`gemini-4-hydrogen`) | Live Staging Evaluation | **BLOCKED** (`0/30` executed) | HTTP `401 MISSING_TOKEN` (`MHIS_CLINICIAN_ID_TOKEN` absent) |
| Live Claim-Level Grounding on Live Gemini Answers | Live Staging Evaluation | **BLOCKED** (`0/30` evaluated) | Depends on live 30-query Gemini execution |
| Live Pretrained Embedding Comparison (`gemini-embedding-2`) | Live Staging Evaluation | **BLOCKED** | CLI `GEMINI_API_KEY` absent & `/api/ai/embedding-eval` HTTP `401` |
| OOV-02 Diagnosis & Surgical Fix (`src/lib/ragEngine.ts`) | Code Fix + Benchmark | **PASSED** | `17/18 -> 18/18` (`100.00%`) Top-1, `1.0000` MRR/nDCG |
| Deterministic 30-Query Retrieval-Only Audit | Synthetic Benchmark | **29/30 PASSED** (`1` defect logged) | `11/11` abstention, `16/16` expected Top-1; `LQ03` abstained |
| Local Unit & Server Integration Test Suite | Local Test Suite | **PASSED** | `49/49` tests (`0` failures, `0` skipped) |
| TypeScript Check & Production Vite Build | Local Build Verification | **PASSED** | `tsc --noEmit` (`0` errors) + `vite build` succeeded |

**Independent Verdict:** Live authenticated Gemini RAG generation, live claim-level grounding on `gemini-4-hydrogen` outputs, live `gemini-embedding-2` evaluation, and live Firestore read/write verification are **BLOCKED** in this sandbox due to missing `MHIS_CLINICIAN_ID_TOKEN`, missing CLI `GEMINI_API_KEY`, and insufficient IAM permissions on the sandbox ADC for Firebase project `magnificent-hydra-r9v0l`. **Zero live responses, credentials, or latencies were mocked or fabricated.** All deterministic retrieval, OOV-02 remediation, security/privacy controls, and server integration behaviors were verified locally (`49/49` tests passing).

---

## 2. Preflight & Infrastructure Verification

### 2.1 Environment & Secret Presence (Non-Sensitive Boolean Audit)
No secret values, tokens, PEM private keys, or API keys were printed or logged during inspection:

- `.env` / `.env.local` on disk: `false` (`.env.example` present: `true`)
- `GEMINI_API_KEY` in CLI shell: `false` (`true` inside the running `localhost:3000` server process per `/api/health`)
- `GOOGLE_APPLICATION_CREDENTIALS` in CLI shell: `false`
- `MHIS_QR_SIGNING_KEYS_JSON` in CLI shell: `false` (server uses `QrEd25519Keyring.fromEnvironment()`, defaulting active key to `mhis-qr-ed25519-k2` when unset and hard-retiring `mhis-qr-ed25519-k1`)
- `MHIS_QR_ACTIVE_KID` in CLI shell: `(unset)` (server `/api/health` reports `mhis-qr-ed25519-k2`, `keyVersion: 2`)
- `MHIS_CLINICIAN_ID_TOKEN` in CLI shell: `false`
- `MHIS_STAGING_BASE_URL` in CLI shell: `(unset)` (defaults to `http://localhost:3000` in `scripts/validate-live-rag.ts`)

### 2.2 Infrastructure Component Checks
1. **Firebase Admin Initialization (`src/lib/firebaseAdminAuth.ts`):**
   - Verified initialization from `/firebase-applet-config.json`: `projectId = "magnificent-hydra-r9v0l"`, `firestoreDatabaseId = "ai-studio-85830e53-0349-481d-ae27-ffdfdecbe5c5"`.
2. **Firebase ID Token Verification & Revocation Checks:**
   - Static inspection confirms `FirebaseAdminAuthVerifier.verifyBearerToken()` calls `this.auth.verifyIdToken(idToken, true)` (`checkRevoked = true`), mapping expired (`401 EXPIRED_TOKEN`), revoked/disabled (`401 REVOKED_TOKEN`), invalid (`401 INVALID_TOKEN`), and credential/network outages (`503 AUTH_UNAVAILABLE`).
   - Live probe against `http://localhost:3000/api/auth/session` with malformed token returned `401 {"ok":false,"code":"INVALID_TOKEN","error":"Invalid Firebase ID token."}`.
   - Direct Admin SDK probe (`auth.listUsers(1)`) from CLI returned `auth/internal-error` referencing quota/ADC project `204913994787` (`identitytoolkit.googleapis.com` unavailable/unauthorized for sandbox ADC).
   - Synthetic JWT issuer probe confirmed Admin verifier expects `iss = "https://securetoken.google.com/magnificent-hydra-r9v0l"`.
3. **Authoritative Clinician Role Lookup:**
   - Verified in `FirestoreAuthoritativeDataStore.getUserRole()`: ignores client-supplied roles; resolves `admin` via verified bootstrap email or `admins/{uid}` / `users/{uid}` (with `emailVerified: true`), `doctor` via `users/{uid}`, defaulting to `patient`.
4. **Patient Ownership & Consent Checks:**
   - Verified in `server.ts` (`/api/patients*`, `/api/consents*`, `/api/qr/*`, `/api/ai/*`): `patient` role is isolated to `record.ownerUid === principal.uid`; `applyInterStateConsent()` strips origin location, external encounters, and external prescriptions when `interStateSharing === false`; missing consent docs fall back to `failClosedConsent()` (all sharing flags `false`).
5. **Firestore Access Probe:**
   - Direct Admin SDK read `db.collection('patients').limit(1).get()` on `magnificent-hydra-r9v0l` / `ai-studio-85830e53-0349-481d-ae27-ffdfdecbe5c5` failed with: `7 PERMISSION_DENIED: Missing or insufficient permissions.`
6. **Gemini API Configuration:**
   - `http://localhost:3000/api/health` returned `"geminiConfigured": true`.
   - `server.ts` configures `gemini-4-hydrogen` (`ThinkingLevel.LOW`) for `/api/ai/assistant` and `/api/ai/risk-assess`, and `src/lib/pretrainedEmbeddings.ts` configures `gemini-embedding-2` via `ai.models.embedContent`.
7. **Active QR Signing Key Metadata:**
   - `http://localhost:3000/api/health` returned: `{"ok":true,"geminiConfigured":true,"qrSchema":"MHIS-QR-v2","qrSignatureAlgorithm":"Ed25519","activeKid":"mhis-qr-ed25519-k2","keyVersion":2}`.
8. **Staging API Health:**
   - `http://localhost:3000/api/health` returned HTTP `200` with `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, and `Referrer-Policy: strict-origin-when-cross-origin`.
   - External URL `https://ais-dev-ezak6fdtw66iajpadr6wup-204913994787.asia-southeast1.run.app/api/health` returned the AI Studio OAuth/cookie authentication interstitial HTML (`__SECURE-aistudio_auth_flow_may_set_cookies`) when accessed without browser session cookies.

---

## 3. Live 30-Query Authenticated Staging Evaluation

### 3.1 Live Execution Status: **BLOCKED (`0/30` Executed)**
Executing `npx --yes tsx scripts/validate-live-rag.ts` against `http://localhost:3000/api/ai/assistant` returned:
```text
LIVE_RAG_BLOCKED: HTTP 401 from http://localhost:3000/api/ai/assistant -> {"ok":false,"code":"MISSING_TOKEN","error":"Authorization: Bearer <Firebase ID Token> header is required."}
```
Because `MHIS_CLINICIAN_ID_TOKEN` is absent and sandbox ADC lacks Firestore (`7 PERMISSION_DENIED`) and Identity Toolkit (`auth/internal-error`) IAM, **no live `gemini-4-hydrogen` answers, generation latencies, or total request latencies were collected or fabricated**.

### 3.2 Query Registry & Observed Deterministic Retrieval-Only Pre-Audit (`29/30` Passed)
Separately from the blocked live Gemini calls, we evaluated the **deterministic retrieval layer** (`retrieveClinicalContextWithReport` after `applyInterStateConsent` using `INITIAL_PATIENTS` and `INITIAL_CONSENTS`) across the 30 queries in `scripts/validate-live-rag.ts`:
- **Deterministic Retrieval Pass Rate:** `29/30` (`96.67%`)
- **Abstention Accuracy:** `11/11` (`100.00%` — all `9` `missing_info` + `2` `consent_restricted` queries abstained)
- **Expected Top-1 Encounter Accuracy (where `expectedEncounterId` specified):** `16/16` (`100.00%`)
- **Mean / Median / p95 Deterministic Retrieval Latency:** `0.5216 ms` / `0.5082 ms` / `0.8054 ms`

| Query ID | Patient ID | Category | Live Staging Status | Deterministic Retrieval Outcome | Retrieved IDs | Evidence Status | Latency (ms) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `LQ01` | `MHIS-BR-MH-1042` | `historical_encounter` | **BLOCKED (401)** | PASS (`ENC-1042-01` #1) | `ENC-1042-01, ENC-1042-02` | `EVIDENCE_FOUND` | `0.8054` |
| `LQ02` | `MHIS-BR-MH-1042` | `clinical_paraphrase` | **BLOCKED (401)** | PASS (`ENC-1042-02` #1) | `ENC-1042-02, ENC-1042-01` | `EVIDENCE_FOUND` | `0.7050` |
| `LQ03` | `MHIS-BR-MH-1042` | `negation` | **BLOCKED (401)** | **FAIL (Abstained)** | `[]` | `MISSING_EVIDENCE` | `0.6938` |
| `LQ04` | `MHIS-BR-MH-1042` | `missing_info` | **BLOCKED (401)** | PASS (Abstained) | `[]` | `MISSING_EVIDENCE` | `0.6633` |
| `LQ05` | `MHIS-BR-MH-1042` | `missing_info` | **BLOCKED (401)** | PASS (Abstained) | `[]` | `MISSING_EVIDENCE` | `0.6227` |
| `LQ06` | `MHIS-OD-GJ-2089` | `normal_vs_missing` | **BLOCKED (401)** | PASS (`ENC-2089-01` #1) | `ENC-2089-01, ENC-2089-02` | `NORMAL_RESULT_DOCUMENTED` | `0.9514` |
| `LQ07` | `MHIS-OD-GJ-2089` | `clinical_paraphrase` | **BLOCKED (401)** | PASS (`ENC-2089-02` #1) | `ENC-2089-02, ENC-2089-01` | `NORMAL_RESULT_DOCUMENTED` | `0.7890` |
| `LQ08` | `MHIS-OD-GJ-2089` | `historical_encounter` | **BLOCKED (401)** | PASS (`ENC-2089-02` #1) | `ENC-2089-02, ENC-2089-01` | `NORMAL_RESULT_DOCUMENTED` | `0.6799` |
| `LQ09` | `MHIS-OD-GJ-2089` | `missing_info` | **BLOCKED (401)** | PASS (Abstained) | `[]` | `MISSING_EVIDENCE` | `0.7403` |
| `LQ10` | `MHIS-OD-GJ-2089` | `negation` | **BLOCKED (401)** | PASS (`ENC-2089-02` #1) | `ENC-2089-02` | `EVIDENCE_FOUND` | `0.7017` |
| `LQ11` | `MHIS-UP-DL-3115` | `clinical_paraphrase` | **BLOCKED (401)** | PASS (`ENC-3115-01` #1) | `ENC-3115-01` | `EVIDENCE_FOUND` | `0.5082` |
| `LQ12` | `MHIS-UP-DL-3115` | `clinical_paraphrase` | **BLOCKED (401)** | PASS (`ENC-3115-01` #1) | `ENC-3115-01` | `EVIDENCE_FOUND` | `0.3976` |
| `LQ13` | `MHIS-UP-DL-3115` | `negation` | **BLOCKED (401)** | PASS (`ENC-3115-01` #1) | `ENC-3115-01` | `EVIDENCE_FOUND` | `0.4455` |
| `LQ14` | `MHIS-UP-DL-3115` | `missing_info` | **BLOCKED (401)** | PASS (Abstained) | `[]` | `MISSING_EVIDENCE` | `0.3666` |
| `LQ15` | `MHIS-UP-DL-3115` | `missing_info` | **BLOCKED (401)** | PASS (Abstained) | `[]` | `MISSING_EVIDENCE` | `0.3483` |
| `LQ16` | `MHIS-WB-KA-4402` | `clinical_paraphrase` | **BLOCKED (401)** | PASS (`ENC-4402-01` #1) | `ENC-4402-01` | `EVIDENCE_FOUND` | `0.4552` |
| `LQ17` | `MHIS-WB-KA-4402` | `medication_status` | **BLOCKED (401)** | PASS (`ENC-4402-01` #1) | `ENC-4402-01` | `EVIDENCE_FOUND` | `0.3521` |
| `LQ18` | `MHIS-WB-KA-4402` | `negation` | **BLOCKED (401)** | PASS (`ENC-4402-01` #1) | `ENC-4402-01` | `EVIDENCE_FOUND` | `0.3534` |
| `LQ19` | `MHIS-WB-KA-4402` | `missing_info` | **BLOCKED (401)** | PASS (Abstained) | `[]` | `MISSING_EVIDENCE` | `0.3821` |
| `LQ20` | `MHIS-WB-KA-4402` | `missing_info` | **BLOCKED (401)** | PASS (Abstained) | `[]` | `MISSING_EVIDENCE` | `0.3342` |
| `LQ21` | `MHIS-JH-TN-5591` | `normal_vs_missing` | **BLOCKED (401)** | PASS (`ENC-5591-01` #1) | `ENC-5591-01` | `NORMAL_RESULT_DOCUMENTED` | `0.3781` |
| `LQ22` | `MHIS-JH-TN-5591` | `clinical_paraphrase` | **BLOCKED (401)** | PASS (`ENC-5591-01` #1) | `ENC-5591-01` | `NORMAL_RESULT_DOCUMENTED` | `0.5099` |
| `LQ23` | `MHIS-JH-TN-5591` | `medication_status` | **BLOCKED (401)** | PASS (`ENC-5591-01` #1) | `ENC-5591-01` | `NORMAL_RESULT_DOCUMENTED` | `0.4019` |
| `LQ24` | `MHIS-JH-TN-5591` | `negation` | **BLOCKED (401)** | PASS (`ENC-5591-01` #1) | `ENC-5591-01` | `NORMAL_RESULT_DOCUMENTED` | `0.3743` |
| `LQ25` | `MHIS-JH-TN-5591` | `missing_info` | **BLOCKED (401)** | PASS (Abstained) | `[]` | `MISSING_EVIDENCE` | `0.5366` |
| `LQ26` | `MHIS-RJ-MH-6720` | `consent_restricted` | **BLOCKED (401)** | PASS (Consent-redacted & Abstained) | `[]` | `MISSING_EVIDENCE` | `0.0584` |
| `LQ27` | `MHIS-RJ-MH-6720` | `consent_restricted` | **BLOCKED (401)** | PASS (Consent-redacted & Abstained) | `[]` | `MISSING_EVIDENCE` | `0.0144` |
| `LQ28` | `MHIS-BR-MH-1042` | `historical_encounter` | **BLOCKED (401)** | PASS (`ENC-1042-01` #1) | `ENC-1042-01, ENC-1042-02` | `EVIDENCE_FOUND` | `0.7391` |
| `LQ29` | `MHIS-OD-GJ-2089` | `historical_encounter` | **BLOCKED (401)** | PASS (`ENC-2089-01` #1) | `ENC-2089-01, ENC-2089-02` | `NORMAL_RESULT_DOCUMENTED` | `0.7174` |
| `LQ30` | `MHIS-UP-DL-3115` | `missing_info` | **BLOCKED (401)** | PASS (Abstained) | `[]` | `MISSING_EVIDENCE` | `0.6227` |

*Note on `LQ03` failure (Section 10):* `MHIS-BR-MH-1042` has `allergies: ['Sulfonamides']`, while `LQ03` asks `"Does he have any documented drug allergies before prescribing Bactrim?"`. Because `allergies` (plural), `Sulfonamides` (plural), and `Bactrim` are missing from `CLINICAL_SYNONYMS`/`CONCEPT_AXES['allergy_adverse']`, deterministic retrieval returned `MISSING_EVIDENCE` (`abstained: true`), though the prompt header in `formatPatientContextForPrompt()` still includes `Allergies: Sulfonamides`.

---

## 4. Claim-Level Grounding & Citation Entailment Audit

### 4.1 Live Gemini Claim-Level Grounding: **BLOCKED (`0/30` Live Answers Evaluated)**
Because `0/30` live Gemini generation requests could be authenticated against staging, live claim-level evaluation of `gemini-4-hydrogen` prose across the 6 grounding categories (Supported / Partially Supported / Unsupported / Contradicted / Temporally Misattributed / Cross-Encounter or Cross-Patient Misattributed) is **BLOCKED / UNEXECUTED**.

### 4.2 Deterministic Claim Entailment Verifier Audit (`verifyClaimsAgainstEvidence`)
Verified via unit tests in `src/lib/ragEngine.test.ts` (`test 34`):
- **Supported by cited evidence (`SUPPORTED`):** `1/1` in synthetic mixed-answer fixture (`ENC-5591-01` hemoglobin `8.9 g/dL`).
- **Contradicted by evidence (`CONTRADICTORY_EVIDENCE`):** `1/1` detected (`Amoxicillin 500mg` recommended despite `Penicillin (urticaria)` allergy -> annotated `[CONFLICT_ALERT: verify allergy/medication conflict]`).
- **Unrelated / Incorrectly attributed to encounter (`UNRELATED_CITATION`):** `1/1` detected (`Serum cholesterol 240 mg/dL [ENC-5591-01]` -> flagged `[UNVERIFIED_CITATION: ENC-5591-01 does not support claim]`).
- **Fabricated / Non-existent encounter citation (`INVALID_CITATION`):** `1/1` detected (`[ENC-9999-FAKE]` -> rewritten to `[UNVERIFIED_REF:ENC-9999-FAKE]`).
- **Unsupported without citation (`UNSUPPORTED_CLAIM`):** `1/1` detected (`MRI brain confirmed acute stroke.` -> tagged `[UNVERIFIED_CLAIM]`).
- **Explicit abstention (`ABSTENTION`):** `1/1` recognized cleanly.
- **Architectural gap noted:** `verifyClaimsAgainstEvidence()` checks numeric/token entailment and allergy/discontinuation contraindications per sentence, but does not yet run an explicit date-to-event temporal misattribution classifier when two encounters share similar drugs at different dates.

---

## 5. Embedding Model Comparison (`gemini-embedding-2` vs Deterministic Baselines)

Dataset: `18` synthetic cases across `6` categories (`3` cases each) from `buildSixCategoryBenchmarkCases()` in `src/lib/pretrainedEmbeddings.ts`.

### 5.1 Overall Comparison Table

| Metric | (A) Existing 128-d Hybrid + BM25 + Intent | (B) Synonym-Expanded BM25 (`retrieveSynonymBm25`) | (C) `gemini-embedding-2` + BM25 + Intent (`/api/ai/embedding-eval`) |
| :--- | :--- | :--- | :--- |
| **Execution Type** | Local Deterministic Benchmark (Post OOV-02 Fix) | Local Deterministic Benchmark | Live Staging / Gemini API |
| **Top-1 Accuracy** | **18/18 (100.00%)** | 15/18 (83.33%) | **BLOCKED** |
| **Precision@K (K<=4)** | **70.83%** *(single ground-truth doc in multi-doc top-K)* | 34.72% | **BLOCKED** |
| **Recall@K (K<=4)** | **18/18 (100.00%)** | 15/18 (83.33%) | **BLOCKED** |
| **MRR** | **1.0000** | 0.8333 | **BLOCKED** |
| **nDCG** | **1.0000** | 0.8333 | **BLOCKED** |
| **Abstention Accuracy** | **3/3 (100.00%)** | 1/3 (33.33%) | **BLOCKED** |
| **Mean Latency (ms)** | `2.5256` *(run 1)* / `1.0045` *(harness)* | `0.2924` | **BLOCKED** |
| **Median Latency (ms)** | `1.4083` | `0.2827` | **BLOCKED** |
| **p95 Latency (ms)** | `17.5145` *(cold JIT case 1)* | `0.8302` | **BLOCKED** |
| **API / Embedding Errors** | None | None | CLI `GEMINI_API_KEY` absent; `/api/ai/embedding-eval` HTTP `401 MISSING_TOKEN` |

### 5.2 Category-Wise Breakdown (`18` Cases, `3` per Category)

| Category | (A) 128-d Hybrid + Intent | (B) Synonym BM25 | (C) `gemini-embedding-2` Hybrid |
| :--- | :--- | :--- | :--- |
| `clinical_paraphrase` | `3/3 (100.00%)` | `3/3 (100.00%)` | **BLOCKED** |
| `historical_encounter` | `3/3 (100.00%)` | `3/3 (100.00%)` | **BLOCKED** |
| `medication_status` (incl. `Q08`) | `3/3 (100.00%)` | `3/3 (100.00%)` | **BLOCKED** |
| `negation` | `3/3 (100.00%)` | `3/3 (100.00%)` | **BLOCKED** |
| `missing_info` (incl. `Q47`) | `3/3 (100.00%)` | `1/3 (33.33%)` *(failed `MI-02`, `MI-03`)* | **BLOCKED** |
| `oov_medical` (incl. `OOV-02`) | `3/3 (100.00%)` | `2/3 (66.67%)` *(failed `OOV-01`)* | **BLOCKED** |

*(Pre-fix Baseline 128-d Hybrid result observed prior to Phase 5.4 edit: `17/18 = 94.44%`, `MRR = 0.9722`, `oov_medical = 2/3 = 66.67%`, sole failure `OOV-02`.)*

---

## 6. OOV-02 Root-Cause Diagnosis & Surgical Remediation

- **Query:** `"Check glycosylated hemoglobin dysglycemia pharmacotherapy"` (`LONGITUDINAL_Q08_Q47_PATIENT`, `MHIS-SYNTH-5001`)
- **Expected Encounter:** `ENC-5001-01` (`2026-02-14`, `Glycemic elevation (OGTT 186 mg/dL, HbA1c 7.8%)`, `Metformin 500mg BD`, `Glimepiride 1mg OD`)
- **Pre-Fix Observed Result:** `ENC-5001-04` (`2026-09-12`, score `0.6347`) ranked #1 ahead of `ENC-5001-01` (score `0.6034`).
- **Exact Root Cause:**
  1. **Missing lexical synonym expansion (`CLINICAL_SYNONYMS`):** `glycosylated` / `glycated` had no expansion to `hba1c`, `dysglycemia` had no expansion to `glycemic` / `glucose` / `diabetes` / `ogtt` / `hba1c`, and `pharmacotherapy` had no expansion to `medications` / `regimen` / `therapy`. Consequently, `bm25Scores` and `subjectBm25Scores` evaluated to `0` on **all four** encounters.
  2. **Saturated concept axis + recency tie-breaker:** `CONCEPT_AXES['dysglycemia']` matched multiple terms in both `ENC-5001-01` and `ENC-5001-04`, clamping identically at `2.5` (`vecSim = 0.6308` vs `0.6322`), so the default `0.04` chronological recency boost pushed the later `ENC-5001-04` above `ENC-5001-01`.
  3. **Missing biomarker specificity guard for `HbA1c`:** `SPECIFIC_BIOMARKER_SYNONYMS` did not map `glycosylated` / `glycated` / `hba1c` to `['hba1c', 'glycosylated', 'glycated', 'a1c']`.
- **Minimal Surgical Fix (`src/lib/ragEngine.ts`):**
  1. Added `hba1c`, `glycosylated`, `glycated`, `dysglycemia`, and `pharmacotherapy` entries to `CLINICAL_SYNONYMS` (without conflating standalone `hemoglobin` with `hba1c`).
  2. Added `hba1c`, `glycosylated`, and `glycated` to `SPECIFIC_BIOMARKER_SYNONYMS` so encounters lacking an affirmative `HbA1c`/`A1c` record do not pass when `HbA1c`/`glycosylated hemoglobin` is specifically queried.
- **Post-Fix Regression Verification (`src/lib/ragEngine.test.ts`):**
  - `OOV-02` returns `ENC-5001-01` at rank #1 (`18/18 = 100.00%` on the 6-category benchmark, `MRR = 1.0000`).
  - Missing `HbA1c` guard verified on `MHIS-OD-GJ-2089` (has `OGTT 158 mg/dL`, no `HbA1c`): query `"What was her glycosylated hemoglobin HbA1c value?"` cleanly returns `abstained: true`, `evidenceStatus: 'MISSING_EVIDENCE'`.
  - `Q08` (`ENC-5001-04` #1, `ENC-5001-01` #2), `Q47` (`MISSING_EVIDENCE`), negation (`ENC-5001-04`), and historical earliest retrieval (`ENC-5001-01`) all pass.

---

## 7. Security & Privacy Regression Verification

| Security / Privacy Control | Live `localhost:3000` Probe | Automated Integration / Unit Test Coverage | Result |
| :--- | :--- | :--- | :--- |
| Unauthenticated `401` enforcement | Verified live on `6/6` endpoints (`GET /api/patients`, `POST /api/ai/assistant`, `POST /api/ai/embedding-eval`, `GET /api/surveillance/summary`, `POST /api/qr/verify`, `GET /api/qr/keys`) -> all `401 MISSING_TOKEN` | `server.security.test.ts` (`6/6` core endpoints + surveillance + embedding-eval) | **PASSED** |
| Invalid / Expired / Revoked Token Rejection | Forged JWT on `POST /api/ai/assistant` -> `401 INVALID_TOKEN` | `server.security.test.ts` (`INVALID_TOKEN`, `EXPIRED_TOKEN`, `REVOKED_TOKEN`) | **PASSED** |
| Unauthorized Role Rejection (`403`) | Not executed live (no role tokens in CLI) | `server.security.test.ts` (`patient` -> `/api/qr/verify` `403`, `doctor` -> `/api/admin/linkage` `403`, `patient` -> `/api/surveillance/summary` `403`) | **PASSED (Local)** |
| Cross-Patient Isolation (`403`) | Not executed live | `server.security.test.ts` (`tok-patient-1` accessing `MHIS-OD-GJ-2089` via `/api/patients/:id` & `/api/qr/issue` -> `403`) | **PASSED (Local)** |
| Consent-Disabled Interstate Redaction | Deterministic retrieval verified (`LQ26`, `LQ27` redacted & abstained) | `consentGuard.test.ts`, `ragEngine.test.ts` (zero origin district/state/dates in prompt), `server.security.test.ts` (`403` after post-login revocation even with spoofed body flags) | **PASSED (Local)** |
| Surveillance Opt-Out, `k >= 3` Suppression & Zero PII | Not executed live (401 without token) | `surveillancePrivacy.test.ts` + `server.security.test.ts` (`optedInCount: 3`, `excludedOptOutCount: 3`, `suppressedCorridorCount: 3`, zero names/Health IDs/restricted origins) | **PASSED (Local)** |
| Prompt Injection Guard | Not executed live (401 without token) | `ragEngine.test.ts` + `server.security.test.ts` (`400` rejection on injection query & `<CLINICAL_EVIDENCE>` note sanitization `[REDACTED_UNTRUSTED_DIRECTIVE]`) | **PASSED (Local)** |
| Missing-Evidence Abstention | Verified in 18-case (`3/3`) & 30-query (`11/11`) deterministic retrieval | `ragEngine.test.ts` (`Q47`, `SGPT/SGOT`, `HbA1c` on Sunita) | **PASSED (Local)** |
| DB Outage Fail-Closed (`503`) | Indirectly confirmed (`401` before DB check; store unavailable -> `503`) | `server.security.test.ts` (`simulateOutage = true` -> `503` authenticated, `401` unauthenticated, `200` `/api/health`) | **PASSED (Local)** |

---

## 8. Evidence Boundary Matrix

| Evidence Category | Live Staging Results | Synthetic Benchmark Results | Local Test Results | Unexecuted / Blocked |
| :--- | :--- | :--- | :--- | :--- |
| **HTTP Health & Headers** | `200` on `localhost:3000/api/health` (`nosniff`, `no-store`) | — | Verified in `server.security.test.ts` | External Cloud Run URL behind AI Studio auth cookie wall |
| **Auth / RBAC / Firestore** | `401` on `7/7` unauth/invalid probes on `localhost:3000` | — | `TestTokenVerifier` & `TestAuthoritativeDataStore` (`49/49` suite) | Live Firebase ID token verification & revocation against Identity Toolkit; live Firestore read/write (`7 PERMISSION_DENIED`) |
| **Clinical RAG Generation (`gemini-4-hydrogen`)** | **None (0/30)** | — | Prompt formatting, citation validation, claim entailment verifier tested locally | Live 30-query Gemini generation, live generation/total latency, live claim-level grounding audit |
| **Clinical Retrieval & OOV-02** | — | `18/18` (`100%`) 6-category benchmark; `29/30` (`96.67%`) retrieval-only on 30-query list | `ragEngine.test.ts` incl. OOV-02 & missing-HbA1c regression | Live `gemini-embedding-2` dense & hybrid comparison (`GEMINI_API_KEY` missing in CLI; `401` on `/api/ai/embedding-eval`) |
| **Ed25519 QR & Surveillance Privacy** | `/api/health` confirms `mhis-qr-ed25519-k2` (v2) active | — | Multi-instance replay race (`1` `200`, `9` `409`), retired `k1` (`403 KEY_RETIRED`), `k >= 3` surveillance (`49/49` suite) | Live `/api/qr/*` and `/api/surveillance/summary` with real Firestore |

---

## 9. Observed Latency & Performance Benchmarks

All latencies below were directly measured in local Node.js (`v22.23.2`) / `tsx` runs. Live end-to-end Gemini API latencies are **unmeasured (BLOCKED)**.

- **18-Case 6-Category Deterministic Retrieval (`A: 128-d Hybrid + Intent`):**
  - Mean: `2.5256 ms` (cold JIT pass) / `1.0045 ms` (warm harness pass)
  - Median: `1.4083 ms`
  - p95: `17.5145 ms` (first-call warmup)
- **18-Case Deterministic Retrieval (`B: Synonym-Expanded BM25`):**
  - Mean: `0.2924 ms` | Median: `0.2827 ms` | p95: `0.8302 ms`
- **30-Query Deterministic Retrieval-Only Audit (`retrieveClinicalContextWithReport`):**
  - Mean: `0.5216 ms` | Median: `0.5082 ms` | p95: `0.8054 ms`
- **1,500-Patient Cohort Stress Test (`server.security.test.ts`):**
  - `assessContinuityRisk` (1,500 patients): `7.93 ms`
  - `evaluateEntityResolution` (1,500 patients): `15.65 ms`
  - `retrieveClinicalContext` (200 patients): `111.87 ms`

---

## 10. Independent Audit Findings & Open Defects

1. **[BLOCKER — Staging Access] Missing Live Staging Credentials & IAM in Sandbox:**
   - `MHIS_CLINICIAN_ID_TOKEN` is unset, `GEMINI_API_KEY` is unavailable to CLI scripts, and container ADC (`204913994787`) fails with `7 PERMISSION_DENIED` on Firestore (`magnificent-hydra-r9v0l`) and `auth/internal-error` on Identity Toolkit. Blocks all live Gemini, live embedding, and live Firestore validation.
2. **[DEFECT — Retrieval / Clinical Safety] `LQ03` Allergy-Drug Synonym Gap (`Sulfonamides` vs `allergies` / `Bactrim`):**
   - Query `"Does he have any documented drug allergies before prescribing Bactrim?"` for `MHIS-BR-MH-1042` (`allergies: ['Sulfonamides']`) abstained (`MISSING_EVIDENCE`) in deterministic retrieval (`1/30` failure) because `CLINICAL_SYNONYMS` and `CONCEPT_AXES['allergy_adverse']` lack plural `allergies` / `sulfonamides` and `bactrim` -> `sulfonamides` mappings (unlike `ALLERGY_DRUG_CONTRAINDICATIONS`, which already maps `Sulfonamides` -> `Bactrim`). Preserved unmodified during Phase 5.4 to avoid unrequested metric tuning; recommended for targeted follow-up fix.
3. **[OBSERVATION — External Dev URL] AI Studio Proxy Cookie Wall:**
   - `https://ais-dev-ezak6fdtw66iajpadr6wup-204913994787.asia-southeast1.run.app/api/health` requires an authenticated browser cookie session before reaching Express.
4. **[OBSERVATION — Verifier Scope] Temporal Claim Ordering:**
   - `verifyClaimsAgainstEvidence()` verifies numeric values, clinical entities, and contraindications per claim/chunk, but does not enforce explicit date-to-event temporal binding across multiple encounters for the same medication.

---

## 11. Cryptographic & Key Management Status (Non-Sensitive)

- Active schema & algorithm (from `GET /api/health`): `MHIS-QR-v2` / `Ed25519`.
- Active signing key metadata: `kid: "mhis-qr-ed25519-k2"`, `keyVersion: 2`.
- Compromised key remediation verified in `src/lib/qrCrypto.ts` & tests: `COMPROMISED_QR_KIDS` permanently enforces `mhis-qr-ed25519-k1` as `retired` (`403 KEY_RETIRED` with `reissuanceRequired: true`); `listPublicMetadata()` strips `privateKeyPem`; zero private key material exists in repo or reports.
- **Note:** Because `MHIS_QR_SIGNING_KEYS_JSON` is unset in CLI env, verify that staging/Cloud Run Secret Manager injects persistent `MHIS_QR_SIGNING_KEYS_JSON` across restarts rather than relying on `QrEd25519Keyring`'s ephemeral per-process `k2` fallback.

---

## 12. Consent & Privacy Governance Verification

- Authoritative consent is stored server-side in Firestore (`consents/{healthId}`) and fails closed (`interStateSharing: false`, `emergencyQrAccess: false`, `anonymizedSurveillance: false`) if missing (`server.ts`).
- `applyInterStateConsent()` redacts origin state/district, external encounters, and external medications before RAG chunking or prompt construction (`consentGuard.ts`, `ragEngine.ts`), confirmed by `consentGuard.test.ts`, `ragEngine.test.ts`, `server.security.test.ts`, and `LQ26`/`LQ27` retrieval checks.
- `buildPrivacyPreservingSurveillanceReport()` excludes all `anonymizedSurveillance !== true` records, masks origin states when `interStateSharing === false`, suppresses cohorts with `0 < n < 3`, and omits all direct identifiers (`surveillancePrivacy.test.ts`, `server.security.test.ts`).

---

## 13. Changes Made in Phase 5.4

- **Modified `/src/lib/ragEngine.ts`:** Surgical fix for `OOV-02` adding `hba1c`, `glycosylated`, `glycated`, `dysglycemia`, and `pharmacotherapy` to `CLINICAL_SYNONYMS` and `hba1c`, `glycosylated`, `glycated` to `SPECIFIC_BIOMARKER_SYNONYMS`.
- **Modified `/src/lib/ragEngine.test.ts`:** Updated `TASK 4` assertion (`18/18` = `100%` Top-1 & `1.00` MRR) and added `Phase 5.4 OOV-02 regression` test covering `OOV-02` and missing-`HbA1c` abstention on `MHIS-OD-GJ-2089`.
- **Created `/PHASE_5_4_LIVE_RAG_VALIDATION.md`:** This audit report.
- **Zero production deployments** and **zero changes** to RBAC, consent rules, dataset ground-truth labels, or UI components.

---

## 14. Build, TypeScript & Test Verification Summary

All automated local checks ran **after** the final code edits to `src/lib/ragEngine.ts` and `src/lib/ragEngine.test.ts`:

- **Unit & Server Integration Suite (`NODE_ENV=test npx --yes tsx --test src/lib/*.test.ts`):** `49/49` tests passed (`0` failed, `0` skipped, duration `3669.35 ms`).
- **TypeScript Type Check (`npm run lint` / `tsc --noEmit`):** Passed (`0` errors).
- **Production Bundle (`npm run build` / `vite build`):** Passed (`dist/` compiled cleanly).

---

## 15. Exact Reproducibility Commands & Staging Unblock Checklist

### 15.1 Unblock Requirements for Live Staging Validation
1. Provision a service account / ADC with `roles/datastore.user` (Firestore read/write) and Firebase Auth verification permissions on project `magnificent-hydra-r9v0l` (`ai-studio-85830e53-0349-481d-ae27-ffdfdecbe5c5`), and verify `identitytoolkit.googleapis.com` is accessible.
2. Seed the synthetic demo dataset via `POST /api/admin/seed-demo` using an authenticated `admin` Firebase ID token (`suryakumar.garikini@gmail.com` or Firestore-provisioned admin).
3. Export valid staging environment variables (never commit or echo values):
   - `MHIS_STAGING_BASE_URL` (staging API base URL)
   - `MHIS_CLINICIAN_ID_TOKEN` (valid Firebase ID token for a staging `doctor` account in Firestore `users/{uid}`)
   - `GEMINI_API_KEY` (if running standalone `gemini-embedding-2` evaluation from CLI)
   - `MHIS_QR_SIGNING_KEYS_JSON` and `MHIS_QR_ACTIVE_KID="mhis-qr-ed25519-k2"` (persistent Secret Manager injection)

### 15.2 Reproducibility Commands
```bash
# 1. Run full local unit, RAG, crypto, consent, surveillance & server security test suite (49 tests)
NODE_ENV=test npx --yes tsx --test src/lib/*.test.ts

# 2. TypeScript & Vite build verification
npm run lint && npm run build

# 3. Run staging preflight + live 30-query RAG + live gemini-embedding-2 evaluation
#    (requires MHIS_CLINICIAN_ID_TOKEN, staging IAM, and GEMINI_API_KEY)
npx --yes tsx scripts/validate-live-rag.ts
```
