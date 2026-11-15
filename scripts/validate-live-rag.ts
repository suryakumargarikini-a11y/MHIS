import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { INITIAL_PATIENTS } from '../src/data/syntheticPatients.ts';
import { getFirebaseAdminApp } from '../src/lib/firebaseAdminAuth.ts';
import {
  evaluateBaseline128dHybrid,
  runPretrainedEmbeddingComparison,
} from '../src/lib/pretrainedEmbeddings.ts';
import type { ClaimVerificationReport } from '../src/lib/ragEngine.ts';
import type { RagSourceChunk } from '../src/types/health.ts';

interface LiveValidationQuery {
  id: string;
  healthId: string;
  query: string;
  category:
    | 'clinical_paraphrase'
    | 'historical_encounter'
    | 'medication_status'
    | 'negation'
    | 'missing_info'
    | 'normal_vs_missing'
    | 'consent_restricted';
  expectAbstention: boolean;
  expectedEncounterId?: string;
}

export const THIRTY_SYNTHETIC_CLINICAL_QUERIES: LiveValidationQuery[] = [
  { id: 'LQ01', healthId: 'MHIS-BR-MH-1042', query: 'What TB regimen was started in Bihar and what is his follow-up status?', category: 'historical_encounter', expectAbstention: false, expectedEncounterId: 'ENC-1042-01' },
  { id: 'LQ02', healthId: 'MHIS-BR-MH-1042', query: 'Why did he receive an emergency 14-day bridge pack in Thane?', category: 'clinical_paraphrase', expectAbstention: false, expectedEncounterId: 'ENC-1042-02' },
  { id: 'LQ03', healthId: 'MHIS-BR-MH-1042', query: 'Does he have any documented drug allergies before prescribing Bactrim?', category: 'negation', expectAbstention: false },
  { id: 'LQ04', healthId: 'MHIS-BR-MH-1042', query: 'What were his liver enzyme ALT or AST lab values?', category: 'missing_info', expectAbstention: true },
  { id: 'LQ05', healthId: 'MHIS-BR-MH-1042', query: 'What did his brain MRI show?', category: 'missing_info', expectAbstention: true },
  { id: 'LQ06', healthId: 'MHIS-OD-GJ-2089', query: 'When was her baseline first-trimester antenatal booking and was the ultrasound normal?', category: 'normal_vs_missing', expectAbstention: false, expectedEncounterId: 'ENC-2089-01' },
  { id: 'LQ07', healthId: 'MHIS-OD-GJ-2089', query: 'What was her OGTT blood sugar result and diabetes medication in Surat?', category: 'clinical_paraphrase', expectAbstention: false, expectedEncounterId: 'ENC-2089-02' },
  { id: 'LQ08', healthId: 'MHIS-OD-GJ-2089', query: 'When is the next antenatal follow-up appointment due?', category: 'historical_encounter', expectAbstention: false, expectedEncounterId: 'ENC-2089-02' },
  { id: 'LQ09', healthId: 'MHIS-OD-GJ-2089', query: 'What were her serum creatinine and eGFR kidney panel values?', category: 'missing_info', expectAbstention: true },
  { id: 'LQ10', healthId: 'MHIS-OD-GJ-2089', query: 'Was she prescribed insulin or only oral Metformin?', category: 'negation', expectAbstention: false, expectedEncounterId: 'ENC-2089-02' },
  { id: 'LQ11', healthId: 'MHIS-UP-DL-3115', query: 'What breathing difficulty spirometry result was recorded in Delhi?', category: 'clinical_paraphrase', expectAbstention: false, expectedEncounterId: 'ENC-3115-01' },
  { id: 'LQ12', healthId: 'MHIS-UP-DL-3115', query: 'What blood pressure reading and heart medicine were prescribed?', category: 'clinical_paraphrase', expectAbstention: false, expectedEncounterId: 'ENC-3115-01' },
  { id: 'LQ13', healthId: 'MHIS-UP-DL-3115', query: 'Can he safely take ibuprofen for masonry joint pain?', category: 'negation', expectAbstention: false },
  { id: 'LQ14', healthId: 'MHIS-UP-DL-3115', query: 'What were his cardiac troponin I levels?', category: 'missing_info', expectAbstention: true },
  { id: 'LQ15', healthId: 'MHIS-UP-DL-3115', query: 'What did his chest CT scan show?', category: 'missing_info', expectAbstention: true },
  { id: 'LQ16', healthId: 'MHIS-WB-KA-4402', query: 'What was his HbA1c percentage in Bengaluru?', category: 'clinical_paraphrase', expectAbstention: false, expectedEncounterId: 'ENC-4402-01' },
  { id: 'LQ17', healthId: 'MHIS-WB-KA-4402', query: 'Which sugar medications is he actively taking?', category: 'medication_status', expectAbstention: false, expectedEncounterId: 'ENC-4402-01' },
  { id: 'LQ18', healthId: 'MHIS-WB-KA-4402', query: 'Has his Glimepiride been discontinued?', category: 'negation', expectAbstention: false, expectedEncounterId: 'ENC-4402-01' },
  { id: 'LQ19', healthId: 'MHIS-WB-KA-4402', query: 'What were his lipid cholesterol and LDL lab values?', category: 'missing_info', expectAbstention: true },
  { id: 'LQ20', healthId: 'MHIS-WB-KA-4402', query: 'What were his liver enzyme AST and SGPT results?', category: 'missing_info', expectAbstention: true },
  { id: 'LQ21', healthId: 'MHIS-JH-TN-5591', query: 'Was her G6PD screening normal before Primaquine?', category: 'normal_vs_missing', expectAbstention: false, expectedEncounterId: 'ENC-5591-01' },
  { id: 'LQ22', healthId: 'MHIS-JH-TN-5591', query: 'What was her hemoglobin level in Tiruppur?', category: 'clinical_paraphrase', expectAbstention: false, expectedEncounterId: 'ENC-5591-01' },
  { id: 'LQ23', healthId: 'MHIS-JH-TN-5591', query: 'Which antimalarial course is completed versus still active?', category: 'medication_status', expectAbstention: false, expectedEncounterId: 'ENC-5591-01' },
  { id: 'LQ24', healthId: 'MHIS-JH-TN-5591', query: 'Is penicillin safe to administer for throat infection?', category: 'negation', expectAbstention: false },
  { id: 'LQ25', healthId: 'MHIS-JH-TN-5591', query: 'What were her serum bilirubin and alkaline phosphatase values?', category: 'missing_info', expectAbstention: true },
  { id: 'LQ26', healthId: 'MHIS-RJ-MH-6720', query: 'What prior encounters are accessible under his current inter-state sharing consent?', category: 'consent_restricted', expectAbstention: true },
  { id: 'LQ27', healthId: 'MHIS-RJ-MH-6720', query: 'What is his current blood pressure medication listed locally?', category: 'consent_restricted', expectAbstention: true },
  { id: 'LQ28', healthId: 'MHIS-BR-MH-1042', query: 'When was his earliest DOTS clinic visit documented?', category: 'historical_encounter', expectAbstention: false, expectedEncounterId: 'ENC-1042-01' },
  { id: 'LQ29', healthId: 'MHIS-OD-GJ-2089', query: 'What was her earliest hemoglobin value in Odisha?', category: 'historical_encounter', expectAbstention: false, expectedEncounterId: 'ENC-2089-01' },
  { id: 'LQ30', healthId: 'MHIS-UP-DL-3115', query: 'What were his thyroid TSH and free T4 values?', category: 'missing_info', expectAbstention: true },
];

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number((sorted[idx] ?? 0).toFixed(2));
}

async function main() {
  const baseUrl = process.env.MHIS_STAGING_BASE_URL?.trim() || 'http://localhost:3000';
  const clinicianToken = process.env.MHIS_CLINICIAN_ID_TOKEN?.trim() || '';
  const apiKey = process.env.GEMINI_API_KEY?.trim() || '';

  console.log('=== PHASE 5.3 LIVE VALIDATION & EMBEDDING EVALUATION HARNESS ===');
  console.log(`Target Base URL: ${baseUrl}`);
  console.log(`Clinician ID Token Provided: ${Boolean(clinicianToken)}`);
  console.log(`GEMINI_API_KEY in CLI Env: ${Boolean(apiKey)}`);

  // 1. Probe Dev/Staging Server Health
  let healthBody: Record<string, unknown> | null = null;
  try {
    const hRes = await fetch(`${baseUrl}/api/health`);
    healthBody = (await hRes.json()) as Record<string, unknown>;
    console.log(`Server /api/health (${hRes.status}): ${JSON.stringify(healthBody)}`);
  } catch (err) {
    console.log(
      `Server /api/health unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 2. Probe Firestore Authoritative Access
  try {
    const admin = getFirebaseAdminApp();
    const snap = await admin.db.collection('patients').limit(1).get();
    console.log(`Direct Firestore Probe: OK (docs=${snap.size})`);
  } catch (err) {
    console.log(
      `Direct Firestore Probe Blocker: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 3. Task 4: Baseline 128-d vs Pretrained gemini-embedding-2 Comparison
  console.log('\n--- TASK 4: EMBEDDING EVALUATION (6 CATEGORIES) ---');
  const geminiClient = apiKey
    ? new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } })
    : null;
  const baseline = evaluateBaseline128dHybrid();
  console.log('Baseline 128-d Hybrid:', JSON.stringify(baseline, null, 2));

  if (clinicianToken) {
    const evalRes = await fetch(`${baseUrl}/api/ai/embedding-eval`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${clinicianToken}`,
      },
    });
    console.log(`Server /api/ai/embedding-eval HTTP ${evalRes.status}`);
    console.log(JSON.stringify(await evalRes.json(), null, 2));
  } else {
    const comparison = await runPretrainedEmbeddingComparison(geminiClient);
    console.log('Pretrained Embedding Comparison:', JSON.stringify(comparison, null, 2));
  }

  // 4. Task 5: Live 30-Query Authenticated Staging Probe (NO MOCKING)
  console.log('\n--- TASK 5: LIVE 30-QUERY GEMINI RAG VALIDATION ---');
  if (!clinicianToken) {
    // Un-mocked live negative check proving Fail-Closed Auth enforcement
    try {
      const unauthProbe = await fetch(`${baseUrl}/api/ai/assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          healthId: INITIAL_PATIENTS[0].healthId,
          query: THIRTY_SYNTHETIC_CLINICAL_QUERIES[0]!.query,
        }),
      });
      const unauthText = await unauthProbe.text();
      console.log(
        `LIVE_RAG_BLOCKED: HTTP ${unauthProbe.status} from ${baseUrl}/api/ai/assistant -> ${unauthText}`,
      );
      console.log(
        'Cannot execute 30 authenticated live Gemini generation requests in sandbox without MHIS_CLINICIAN_ID_TOKEN and Firestore staging IAM. Zero requests mocked or fabricated.',
      );
    } catch (err) {
      console.log(
        `LIVE_RAG_PROBE_ERROR: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }

  const results: Array<{
    id: string;
    healthId: string;
    query: string;
    httpStatus: number;
    model?: string;
    retrievalAbstained?: boolean;
    evidenceStatus?: string;
    retrievedIds: string[];
    validCitations: string[];
    invalidCitations: string[];
    unrelatedCitations: string[];
    supportedRate?: number;
    unsupportedClaims?: number;
    contradictoryClaims?: number;
    generationLatencyMs?: number;
    totalLatencyMs?: number;
    answerPreview?: string;
    error?: string;
  }> = [];

  for (const item of THIRTY_SYNTHETIC_CLINICAL_QUERIES) {
    const t0 = performance.now();
    const res = await fetch(`${baseUrl}/api/ai/assistant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${clinicianToken}`,
      },
      body: JSON.stringify({ healthId: item.healthId, query: item.query }),
    });
    const clientTotalMs = Number((performance.now() - t0).toFixed(2));
    const body = (await res.json()) as {
      ok?: boolean;
      error?: string;
      answer?: string;
      model?: string;
      retrievalAbstained?: boolean;
      evidenceStatus?: string;
      sources?: RagSourceChunk[];
      validCitations?: string[];
      invalidCitations?: string[];
      unrelatedCitations?: string[];
      claimVerification?: ClaimVerificationReport;
      generationLatencyMs?: number;
      totalLatencyMs?: number;
    };

    results.push({
      id: item.id,
      healthId: item.healthId,
      query: item.query,
      httpStatus: res.status,
      model: body.model,
      retrievalAbstained: body.retrievalAbstained,
      evidenceStatus: body.evidenceStatus,
      retrievedIds: (body.sources ?? []).map((s) => s.encounterId),
      validCitations: body.validCitations ?? [],
      invalidCitations: body.invalidCitations ?? [],
      unrelatedCitations: body.unrelatedCitations ?? [],
      supportedRate: body.claimVerification?.supportedRate,
      unsupportedClaims: body.claimVerification?.unsupportedClaims,
      contradictoryClaims: body.claimVerification?.contradictoryClaims,
      generationLatencyMs: body.generationLatencyMs,
      totalLatencyMs: body.totalLatencyMs ?? clientTotalMs,
      answerPreview: body.answer?.slice(0, 220),
      error: body.error,
    });
  }

  const genLatencies = results
    .map((r) => r.generationLatencyMs)
    .filter((n): n is number => typeof n === 'number');
  const totLatencies = results
    .map((r) => r.totalLatencyMs)
    .filter((n): n is number => typeof n === 'number');
  const avgGen =
    genLatencies.length > 0
      ? Number((genLatencies.reduce((a, b) => a + b, 0) / genLatencies.length).toFixed(2))
      : 0;
  const avgTot =
    totLatencies.length > 0
      ? Number((totLatencies.reduce((a, b) => a + b, 0) / totLatencies.length).toFixed(2))
      : 0;

  console.log(
    JSON.stringify(
      {
        executedQueries: results.length,
        succeeded200: results.filter((r) => r.httpStatus === 200).length,
        avgGenerationLatencyMs: avgGen,
        p95GenerationLatencyMs: percentile(genLatencies, 95),
        avgTotalLatencyMs: avgTot,
        p95TotalLatencyMs: percentile(totLatencies, 95),
        results,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
