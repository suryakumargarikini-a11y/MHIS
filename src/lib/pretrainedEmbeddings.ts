import type { GoogleGenAI } from '@google/genai';
import { INITIAL_PATIENTS } from '../data/syntheticPatients.ts';
import type { ClinicalEncounter, MigrantPatient, RagSourceChunk } from '../types/health.ts';
import {
  classifyClinicalQueryIntent,
  analyzeEncounterMedicationStatus,
  retrieveClinicalContextWithReport,
} from './ragEngine.ts';

export type EmbeddingEvalCategory =
  | 'clinical_paraphrase'
  | 'historical_encounter'
  | 'medication_status'
  | 'negation'
  | 'missing_info'
  | 'oov_medical';

export interface EmbeddingEvalCase {
  id: string;
  category: EmbeddingEvalCategory;
  patient: MigrantPatient;
  query: string;
  expectedEncounterId: string | null; // null => expect abstention (MISSING_EVIDENCE)
  expectAbstention: boolean;
}

export interface StrategyEvalMetrics {
  strategyName: string;
  totalCases: number;
  top1Accuracy: number;
  mrr: number;
  abstentionAccuracy: number;
  meanLatencyMs: number;
  byCategory: Record<
    EmbeddingEvalCategory,
    {
      total: number;
      passed: number;
      accuracy: number;
    }
  >;
  failures: Array<{ id: string; category: string; query: string; expected: string; got: string }>;
}

export interface PretrainedComparisonReport {
  model: string;
  totalCases: number;
  baseline128dHybrid: StrategyEvalMetrics;
  pretrainedDenseOnly: StrategyEvalMetrics | null;
  pretrainedHybridRrf: StrategyEvalMetrics | null;
  liveEmbeddingError: string | null;
}

/**
 * Multi-encounter longitudinal synthetic benchmark patient covering Q08 (Metformin discontinued
 * after initial prescription) and Q47 (missing ALT/AST liver enzymes).
 */
export const LONGITUDINAL_Q08_Q47_PATIENT: MigrantPatient = {
  ...INITIAL_PATIENTS[3],
  healthId: 'MHIS-SYNTH-5001',
  fullName: 'Harishankar Prasad Verma (Synthetic)',
  age: 46,
  gender: 'Male',
  originState: 'Bihar',
  originDistrict: 'Gaya',
  currentState: 'Maharashtra',
  currentDistrict: 'Mumbai',
  chronicConditions: ['Type 2 Diabetes Mellitus', 'Occupational Lumbar Strain'],
  activeMedications: ['Glimepiride 1mg OD', 'Paracetamol 500mg PRN'],
  encounters: [
    {
      encounterId: 'ENC-5001-01',
      patientHealthId: 'MHIS-SYNTH-5001',
      facilityName: 'Gaya Sadar PHC',
      district: 'Gaya',
      state: 'Bihar',
      encounterDate: '2026-02-14',
      encounterType: 'Outpatient',
      diagnosis: 'Glycemic elevation (OGTT 186 mg/dL, HbA1c 7.8%)',
      icdCode: 'E11.9',
      medications: ['Metformin 500mg BD', 'Glimepiride 1mg OD'],
      followUpRequired: true,
      followUpDueDate: '2026-03-14',
      clinicianName: 'Dr. R. K. Sinha (Synthetic)',
      notes: 'Started oral glucose control with Metformin 500mg BD and Glimepiride 1mg OD.',
      sourceSystem: 'Bihar-PHC Demo',
    },
    {
      encounterId: 'ENC-5001-02',
      patientHealthId: 'MHIS-SYNTH-5001',
      facilityName: 'Andheri ESIC Dispensary',
      district: 'Mumbai',
      state: 'Maharashtra',
      encounterDate: '2026-05-19',
      encounterType: 'Outpatient',
      diagnosis: 'Acute bacterial pharyngitis & sore throat',
      icdCode: 'J02.9',
      medications: ['Azithromycin 500mg OD 5 days'],
      followUpRequired: false,
      followUpDueDate: null,
      clinicianName: 'Dr. N. Kulkarni (Synthetic)',
      notes: 'Throat swab consistent with bacterial pharyngitis; prescribed macrolide course.',
      sourceSystem: 'MahaHealth-PHC Demo',
    },
    {
      encounterId: 'ENC-5001-03',
      patientHealthId: 'MHIS-SYNTH-5001',
      facilityName: 'Kurla Municipal Clinic',
      district: 'Mumbai',
      state: 'Maharashtra',
      encounterDate: '2026-07-08',
      encounterType: 'Occupational Screening',
      diagnosis: 'Lumbar radiculopathy after heavy masonry lifting',
      icdCode: 'M54.1',
      medications: ['Paracetamol 500mg PRN'],
      followUpRequired: true,
      followUpDueDate: '2026-08-08',
      clinicianName: 'Dr. P. Sawant (Synthetic)',
      notes: 'Advised lumbar belt and ergonomic rest. No liver function panel ordered.',
      sourceSystem: 'MahaHealth-PHC Demo',
    },
    {
      encounterId: 'ENC-5001-04',
      patientHealthId: 'MHIS-SYNTH-5001',
      facilityName: 'Andheri ESIC Dispensary',
      district: 'Mumbai',
      state: 'Maharashtra',
      encounterDate: '2026-09-12',
      encounterType: 'Outpatient',
      diagnosis: 'Metformin GI intolerance; diabetes therapy adjustment',
      icdCode: 'E11.9',
      medications: ['Metformin discontinued due to GI intolerance', 'Glimepiride 1mg OD continued'],
      followUpRequired: true,
      followUpDueDate: '2026-10-12',
      clinicianName: 'Dr. N. Kulkarni (Synthetic)',
      notes:
        'Treatment interruption assessment: patient experienced persistent nausea and diarrhea; Metformin was discontinued due to GI intolerance while Glimepiride 1mg OD remained active.',
      sourceSystem: 'MahaHealth-PHC Demo',
    },
  ],
};

export const SILICOSIS_MULTI_PATIENT: MigrantPatient = {
  ...INITIAL_PATIENTS[2],
  healthId: 'MHIS-SYNTH-5002',
  encounters: [
    {
      encounterId: 'ENC-5002-01',
      patientHealthId: 'MHIS-SYNTH-5002',
      facilityName: 'Azamgarh CHC',
      district: 'Azamgarh',
      state: 'Uttar Pradesh',
      encounterDate: '2026-01-20',
      encounterType: 'Occupational Screening',
      diagnosis: 'Early occupational silicosis & spirometry FEV1 76%',
      icdCode: 'J62.8',
      medications: ['Budesonide Inhaler 200mcg BD'],
      followUpRequired: true,
      followUpDueDate: '2026-02-20',
      clinicianName: 'Dr. A. Verma (Synthetic)',
      notes: 'Baseline respiratory screening normal cardiac auscultation.',
      sourceSystem: 'UP-PHC Demo',
    },
    {
      encounterId: 'ENC-5002-02',
      patientHealthId: 'MHIS-SYNTH-5002',
      facilityName: 'Okhla Industrial ESIC Dispensary',
      district: 'South East Delhi',
      state: 'Delhi NCR',
      encounterDate: '2026-06-18',
      encounterType: 'Outpatient',
      diagnosis: 'Stage II Hypertension (156/96 mmHg)',
      icdCode: 'I10',
      medications: ['Amlodipine 5mg OD (paused pending orthostatic check)'],
      followUpRequired: true,
      followUpDueDate: '2026-07-02',
      clinicianName: 'Dr. Harish Malhotra (Synthetic)',
      notes: 'Amlodipine temporarily paused for 48 hours due to mild dizziness; review BP.',
      sourceSystem: 'Delhi-Mohalla Demo',
    },
    {
      encounterId: 'ENC-5002-03',
      patientHealthId: 'MHIS-SYNTH-5002',
      facilityName: 'Okhla Industrial ESIC Dispensary',
      district: 'South East Delhi',
      state: 'Delhi NCR',
      encounterDate: '2026-10-15',
      encounterType: 'Outpatient',
      diagnosis: 'Mild wrist sprain after stone transport',
      icdCode: 'S63.5',
      medications: ['Topical diclofenac gel'],
      followUpRequired: false,
      followUpDueDate: null,
      clinicianName: 'Dr. Harish Malhotra (Synthetic)',
      notes: 'Routine musculoskeletal evaluation.',
      sourceSystem: 'Delhi-Mohalla Demo',
    },
  ],
};

export function buildSixCategoryBenchmarkCases(): EmbeddingEvalCase[] {
  const ramesh = INITIAL_PATIENTS[0];
  const sunita = INITIAL_PATIENTS[1];
  const lakshmi = INITIAL_PATIENTS[4];

  return [
    // 1. Clinical Paraphrase Retrieval
    {
      id: 'CP-01',
      category: 'clinical_paraphrase',
      patient: LONGITUDINAL_Q08_Q47_PATIENT,
      query: 'Which visit reported a severe sore throat infection?',
      expectedEncounterId: 'ENC-5001-02',
      expectAbstention: false,
    },
    {
      id: 'CP-02',
      category: 'clinical_paraphrase',
      patient: SILICOSIS_MULTI_PATIENT,
      query: 'When was his breathing difficulty lung test recorded?',
      expectedEncounterId: 'ENC-5002-01',
      expectAbstention: false,
    },
    {
      id: 'CP-03',
      category: 'clinical_paraphrase',
      patient: SILICOSIS_MULTI_PATIENT,
      query: 'Where was his high arterial heart pressure diagnosed?',
      expectedEncounterId: 'ENC-5002-02',
      expectAbstention: false,
    },

    // 2. Historical Encounter Retrieval
    {
      id: 'HE-01',
      category: 'historical_encounter',
      patient: LONGITUDINAL_Q08_Q47_PATIENT,
      query: 'When was his high blood sugar first noted?',
      expectedEncounterId: 'ENC-5001-01',
      expectAbstention: false,
    },
    {
      id: 'HE-02',
      category: 'historical_encounter',
      patient: sunita,
      query: 'What were the findings on her baseline first trimester ultrasound booking?',
      expectedEncounterId: 'ENC-2089-01',
      expectAbstention: false,
    },
    {
      id: 'HE-03',
      category: 'historical_encounter',
      patient: ramesh,
      query: 'When was Category-I DOTS originally initiated in Bihar?',
      expectedEncounterId: 'ENC-1042-01',
      expectAbstention: false,
    },

    // 3. Medication Status (including Q08)
    {
      id: 'MS-Q08',
      category: 'medication_status',
      patient: LONGITUDINAL_Q08_Q47_PATIENT,
      query: 'Why was his sugar medicine stopped?',
      expectedEncounterId: 'ENC-5001-04',
      expectAbstention: false,
    },
    {
      id: 'MS-02',
      category: 'medication_status',
      patient: SILICOSIS_MULTI_PATIENT,
      query: 'Why was his blood pressure pill temporarily paused?',
      expectedEncounterId: 'ENC-5002-02',
      expectAbstention: false,
    },
    {
      id: 'MS-03',
      category: 'medication_status',
      patient: LONGITUDINAL_Q08_Q47_PATIENT,
      query: 'When was Metformin originally started?',
      expectedEncounterId: 'ENC-5001-01',
      expectAbstention: false,
    },

    // 4. Negation
    {
      id: 'NG-01',
      category: 'negation',
      patient: LONGITUDINAL_Q08_Q47_PATIENT,
      query: 'Which diabetes medicine was not stopped and is he still taking?',
      expectedEncounterId: 'ENC-5001-04',
      expectAbstention: false,
    },
    {
      id: 'NG-02',
      category: 'negation',
      patient: lakshmi,
      query: 'Was her malaria G6PD screening normal rather than deficient?',
      expectedEncounterId: 'ENC-5591-01',
      expectAbstention: false,
    },
    {
      id: 'NG-03',
      category: 'negation',
      patient: sunita,
      query: 'Was her baseline antenatal ultrasound unremarkable without abnormalities?',
      expectedEncounterId: 'ENC-2089-01',
      expectAbstention: false,
    },

    // 5. Missing Information / Abstention (including Q47)
    {
      id: 'MI-Q47',
      category: 'missing_info',
      patient: LONGITUDINAL_Q08_Q47_PATIENT,
      query: 'What were his liver enzyme ALT or AST lab values?',
      expectedEncounterId: null,
      expectAbstention: true,
    },
    {
      id: 'MI-02',
      category: 'missing_info',
      patient: SILICOSIS_MULTI_PATIENT,
      query: 'What did his cardiac troponin I and brain MRI show?',
      expectedEncounterId: null,
      expectAbstention: true,
    },
    {
      id: 'MI-03',
      category: 'missing_info',
      patient: sunita,
      query: 'What were her serum creatinine and eGFR renal function values?',
      expectedEncounterId: null,
      expectAbstention: true,
    },

    // 6. Out-of-Vocabulary (OOV) Medical Expressions
    {
      id: 'OOV-01',
      category: 'oov_medical',
      patient: SILICOSIS_MULTI_PATIENT,
      query: 'Evaluate pulmonary parenchymal dust pneumoconiosis spirometric airflow',
      expectedEncounterId: 'ENC-5002-01',
      expectAbstention: false,
    },
    {
      id: 'OOV-02',
      category: 'oov_medical',
      patient: LONGITUDINAL_Q08_Q47_PATIENT,
      query: 'Check glycosylated hemoglobin dysglycemia pharmacotherapy',
      expectedEncounterId: 'ENC-5001-01',
      expectAbstention: false,
    },
    {
      id: 'OOV-03',
      category: 'oov_medical',
      patient: LONGITUDINAL_Q08_Q47_PATIENT,
      query: 'Check sciatic radicular lumbago lifting injury',
      expectedEncounterId: 'ENC-5001-03',
      expectAbstention: false,
    },
  ];
}

function buildEncText(patient: MigrantPatient, enc: ClinicalEncounter): string {
  return `${enc.encounterDate} ${enc.encounterType} ${enc.state} ${enc.district} ${enc.diagnosis} ${enc.icdCode} ${enc.medications.join(' ')} ${enc.notes} allergies ${patient.allergies.join(' ')}`;
}

function dotCosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const va = a[i]!;
    const vb = b[i]!;
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

function initCategoryStats() {
  return {
    clinical_paraphrase: { total: 0, passed: 0, accuracy: 0 },
    historical_encounter: { total: 0, passed: 0, accuracy: 0 },
    medication_status: { total: 0, passed: 0, accuracy: 0 },
    negation: { total: 0, passed: 0, accuracy: 0 },
    missing_info: { total: 0, passed: 0, accuracy: 0 },
    oov_medical: { total: 0, passed: 0, accuracy: 0 },
  };
}

export function evaluateBaseline128dHybrid(
  cases: EmbeddingEvalCase[] = buildSixCategoryBenchmarkCases(),
): StrategyEvalMetrics {
  const byCategory = initCategoryStats();
  const failures: StrategyEvalMetrics['failures'] = [];
  let hits = 0;
  let mrrSum = 0;
  let abstentionCases = 0;
  let abstentionCorrect = 0;
  const t0 = performance.now();

  for (const c of cases) {
    byCategory[c.category].total += 1;
    const report = retrieveClinicalContextWithReport(c.patient, c.query, 4, {
      strictAbstention: true,
    });

    if (c.expectAbstention) {
      abstentionCases += 1;
      if (report.abstained && report.chunks.length === 0) {
        hits += 1;
        mrrSum += 1;
        abstentionCorrect += 1;
        byCategory[c.category].passed += 1;
      } else {
        failures.push({
          id: c.id,
          category: c.category,
          query: c.query,
          expected: 'ABSTAIN',
          got: report.chunks[0]?.encounterId ?? 'EMPTY',
        });
      }
      continue;
    }

    const topId = report.chunks[0]?.encounterId ?? 'ABSTAIN';
    const rankIdx = report.chunks.findIndex((ch) => ch.encounterId === c.expectedEncounterId);
    if (rankIdx >= 0) mrrSum += 1 / (rankIdx + 1);

    if (topId === c.expectedEncounterId) {
      hits += 1;
      byCategory[c.category].passed += 1;
    } else {
      failures.push({
        id: c.id,
        category: c.category,
        query: c.query,
        expected: c.expectedEncounterId ?? 'ABSTAIN',
        got: topId,
      });
    }
  }

  const elapsed = performance.now() - t0;
  for (const cat of Object.values(byCategory)) {
    cat.accuracy = cat.total > 0 ? Number((cat.passed / cat.total).toFixed(4)) : 1;
  }

  return {
    strategyName: 'Baseline 128-d Hybrid (BM25 + Concept/CharHash + RRF + Intent)',
    totalCases: cases.length,
    top1Accuracy: Number((hits / Math.max(1, cases.length)).toFixed(4)),
    mrr: Number((mrrSum / Math.max(1, cases.length)).toFixed(4)),
    abstentionAccuracy:
      abstentionCases > 0 ? Number((abstentionCorrect / abstentionCases).toFixed(4)) : 1,
    meanLatencyMs: Number((elapsed / Math.max(1, cases.length)).toFixed(4)),
    byCategory,
    failures,
  };
}

/**
 * Runs an independent side-by-side comparison using Gemini's genuine pretrained
 * embedding model (`gemini-embedding-2`) via `@google/genai` `ai.models.embedContent`.
 */
export function getConfiguredEmbeddingModel(): string {
  return process.env.GEMINI_EMBEDDING_MODEL?.trim() || 'gemini-embedding-2';
}

export async function runPretrainedEmbeddingComparison(
  geminiClient: GoogleGenAI | null,
  cases: EmbeddingEvalCase[] = buildSixCategoryBenchmarkCases(),
): Promise<PretrainedComparisonReport> {
  const baseline128dHybrid = evaluateBaseline128dHybrid(cases);
  const embeddingModel = getConfiguredEmbeddingModel();
  if (!geminiClient) {
    return {
      model: embeddingModel,
      totalCases: cases.length,
      baseline128dHybrid,
      pretrainedDenseOnly: null,
      pretrainedHybridRrf: null,
      liveEmbeddingError:
        `GEMINI_API_KEY not available in runtime environment; pretrained ${embeddingModel} evaluation skipped without mocking.`,
    };
  }

  try {
    // Deduplicate document and query texts to minimize live embedding RPC volume
    const uniqueTexts = new Set<string>();
    for (const c of cases) {
      uniqueTexts.add(`Q:${c.query}`);
      for (const enc of c.patient.encounters) {
        uniqueTexts.add(`D:${enc.encounterId}:${buildEncText(c.patient, enc)}`);
      }
    }

    const keys = Array.from(uniqueTexts);
    const rawInputs = keys.map((k) =>
      k.startsWith('Q:') ? k.slice(2) : k.replace(/^D:[^:]+:/, ''),
    );

    const tStart = performance.now();
    const res = await geminiClient.models.embedContent({
      model: embeddingModel,
      contents: rawInputs,
    });
    const embedLatencyMs = performance.now() - tStart;

    const vectors = new Map<string, number[]>();
    keys.forEach((key, idx) => {
      const vals = res.embeddings?.[idx]?.values;
      if (vals && vals.length > 0) vectors.set(key, vals);
    });

    if (vectors.size !== keys.length) {
      throw new Error(
        `Pretrained embedding response incomplete: received ${vectors.size}/${keys.length} vectors.`,
      );
    }

    const evaluateDense = (hybridBlend: boolean): StrategyEvalMetrics => {
      const byCategory = initCategoryStats();
      const failures: StrategyEvalMetrics['failures'] = [];
      let hits = 0;
      let mrrSum = 0;
      let abstentionCases = 0;
      let abstentionCorrect = 0;
      const DENSE_ABSTENTION_THRESHOLD = hybridBlend ? 0.28 : 0.62;

      for (const c of cases) {
        byCategory[c.category].total += 1;
        const qVec = vectors.get(`Q:${c.query}`)!;
        const intent = classifyClinicalQueryIntent(c.query);
        const baselineReport = retrieveClinicalContextWithReport(c.patient, c.query, 4, {
          strictAbstention: true,
        });
        const baselineById = new Map<string, RagSourceChunk>(
          baselineReport.chunks.map((ch) => [ch.encounterId, ch]),
        );

        const ranked = c.patient.encounters
          .map((enc) => {
            const dVec = vectors.get(`D:${enc.encounterId}:${buildEncText(c.patient, enc)}`)!;
            const cos = dotCosine(qVec, dVec);
            if (!hybridBlend) {
              return { id: enc.encounterId, score: cos };
            }
            const medStatus = analyzeEncounterMedicationStatus(enc);
            const baseChunk = baselineById.get(enc.encounterId);
            const lexBoost = baseChunk ? Math.min(0.4, baseChunk.relevanceScore * 0.35) : 0;
            const statusAdj =
              intent.medicationStatusIntent === 'CESSATION_CHANGE' && medStatus.hasCessationOrHold
                ? 0.25
                : 0;
            const hybridScore = baselineReport.abstained
              ? Math.min(0.18, cos * 0.25)
              : 0.55 * cos + lexBoost + statusAdj;
            return { id: enc.encounterId, score: hybridScore };
          })
          .sort((a, b) => b.score - a.score);

        const top = ranked[0];
        const abstained = hybridBlend
          ? baselineReport.abstained
          : !top || top.score < DENSE_ABSTENTION_THRESHOLD;

        if (c.expectAbstention) {
          abstentionCases += 1;
          if (abstained) {
            hits += 1;
            mrrSum += 1;
            abstentionCorrect += 1;
            byCategory[c.category].passed += 1;
          } else {
            failures.push({
              id: c.id,
              category: c.category,
              query: c.query,
              expected: 'ABSTAIN',
              got: `${top?.id} (score=${top?.score.toFixed(3)})`,
            });
          }
          continue;
        }

        const gotId = abstained ? 'ABSTAIN' : (top?.id ?? 'ABSTAIN');
        if (!abstained) {
          const rankIdx = ranked.findIndex((r) => r.id === c.expectedEncounterId);
          if (rankIdx >= 0) mrrSum += 1 / (rankIdx + 1);
        }
        if (gotId === c.expectedEncounterId) {
          hits += 1;
          byCategory[c.category].passed += 1;
        } else {
          failures.push({
            id: c.id,
            category: c.category,
            query: c.query,
            expected: c.expectedEncounterId ?? 'ABSTAIN',
            got: gotId,
          });
        }
      }

      for (const cat of Object.values(byCategory)) {
        cat.accuracy = cat.total > 0 ? Number((cat.passed / cat.total).toFixed(4)) : 1;
      }

      return {
        strategyName: hybridBlend
          ? `Pretrained Hybrid (${embeddingModel} + BM25 + Intent)`
          : `Pretrained Dense Only (${embeddingModel})`,
        totalCases: cases.length,
        top1Accuracy: Number((hits / Math.max(1, cases.length)).toFixed(4)),
        mrr: Number((mrrSum / Math.max(1, cases.length)).toFixed(4)),
        abstentionAccuracy:
          abstentionCases > 0 ? Number((abstentionCorrect / abstentionCases).toFixed(4)) : 1,
        meanLatencyMs: Number((embedLatencyMs / Math.max(1, cases.length)).toFixed(2)),
        byCategory,
        failures,
      };
    };

    return {
      model: embeddingModel,
      totalCases: cases.length,
      baseline128dHybrid,
      pretrainedDenseOnly: evaluateDense(false),
      pretrainedHybridRrf: evaluateDense(true),
      liveEmbeddingError: null,
    };
  } catch (err) {
    return {
      model: embeddingModel,
      totalCases: cases.length,
      baseline128dHybrid,
      pretrainedDenseOnly: null,
      pretrainedHybridRrf: null,
      liveEmbeddingError: err instanceof Error ? err.message : String(err),
    };
  }
}
