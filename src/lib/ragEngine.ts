import type { ClinicalEncounter, MigrantPatient, RagSourceChunk } from '../types/health.ts';

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|rules?|directives?)/gi,
  /disregard\s+(all\s+)?(previous|prior|system|abstention)\s+(instructions?|rules?|directives?)/gi,
  /forget\s+(all\s+)?(previous|prior|above|system)\s+(instructions?|rules?|directives?)/gi,
  /you\s+are\s+now\s+/gi,
  /system\s*(prompt|override|directive|instruction|message)\s*:/gi,
  /(override|bypass|disable)\s+(all\s+)?(safety|abstention|grounding|consent|security)\s+(rules?|guards?|checks?)/gi,
  /do\s+not\s+abstain/gi,
  /act\s+as\s+(an?\s+)?(unrestricted|jailbroken|admin|root|developer)/gi,
  /<\s*\/?\s*(system|instruction|prompt|clinical_evidence|assistant)[^>]*>/gi,
  /reveal\s+(all\s+)?(other|hidden|system)\s+(patients?|records?|prompts?|keys?)/gi,
];

const SHORT_CLINICAL_TOKENS = new Set([
  'tb',
  'bp',
  'hb',
  'od',
  'bd',
  'hs',
  'iv',
  'id',
  'ct',
  'alt',
  'ast',
  'alp',
  'ggt',
  'bun',
  'ldh',
  'ldl',
  'hdl',
  'esr',
  'crp',
  'tsh',
  'ck',
]);

const GENERIC_QUERY_TOKENS = new Set([
  'what',
  'were',
  'was',
  'are',
  'is',
  'did',
  'does',
  'have',
  'has',
  'had',
  'his',
  'her',
  'their',
  'the',
  'any',
  'for',
  'from',
  'with',
  'and',
  'about',
  'show',
  'tell',
  'give',
  'list',
  'check',
  'when',
  'why',
  'how',
  'which',
  'where',
  'who',
  'values',
  'value',
  'levels',
  'level',
  'results',
  'result',
  'reading',
  'readings',
  'test',
  'tests',
  'lab',
  'labs',
  'panel',
  'report',
  'reports',
  'scan',
  'scans',
  'note',
  'notes',
  'recorded',
  'documented',
  'mention',
  'mentioned',
  'patient',
  'visit',
  'visits',
  'clinic',
  'clinical',
  'record',
  'records',
  'encounter',
  'encounters',
  'latest',
  'recent',
  'last',
  'current',
  'first',
  'next',
  'upcoming',
  'most',
  'still',
  'taking',
  'medicine',
  'medicines',
  'meds',
  'medication',
  'medications',
  'drug',
  'drugs',
  'therapy',
  'evaluate',
  'assess',
  'review',
  'summarize',
  'summary',
  'explain',
]);

const CLINICAL_SYNONYMS: Record<string, string[]> = {
  tb: ['tuberculosis', 'dots'],
  tuberculosis: ['tb', 'dots'],
  bp: ['hypertension', 'mmhg', 'pressure'],
  hypertension: ['bp', 'pressure', 'arterial'],
  hb: ['hemoglobin', 'anemia'],
  hemoglobin: ['hb', 'anemia'],
  follow: ['followup', 'due', 'review'],
  followup: ['follow', 'due', 'review'],
  due: ['followup', 'follow'],
  meds: ['medications', 'medication'],
  medications: ['meds', 'regimen', 'therapy'],
  sugar: ['glucose', 'glycemic', 'diabetes', 'ogtt', 'hba1c', 'metformin', 'glimepiride', 'insulin'],
  glycemic: ['sugar', 'glucose', 'diabetes', 'metformin', 'glimepiride'],
  diabetes: ['glycemic', 'sugar', 'glucose', 'metformin', 'glimepiride', 'insulin'],
  hba1c: ['glycosylated', 'glycated', 'glycemic'],
  glycosylated: ['hba1c', 'glycated', 'glycemic'],
  glycated: ['hba1c', 'glycosylated', 'glycemic'],
  dysglycemia: ['glycemic', 'glucose', 'diabetes', 'sugar', 'ogtt', 'hba1c'],
  pharmacotherapy: ['medications', 'medication', 'regimen', 'therapy', 'prescribed'],
  metformin: ['sugar', 'diabetes', 'glycemic', 'glucose'],
  glimepiride: ['sugar', 'diabetes', 'glycemic', 'glucose'],
  insulin: ['sugar', 'diabetes', 'glycemic', 'glucose'],
  breathing: ['dyspnea', 'respiratory', 'spirometry', 'inhaler', 'cough', 'budesonide'],
  dyspnea: ['breathing', 'respiratory', 'spirometry', 'budesonide'],
  heart: ['cardiovascular', 'cardiac', 'hypertension', 'amlodipine', 'telmisartan', 'atorvastatin'],
  cardiovascular: ['heart', 'cardiac', 'hypertension', 'amlodipine', 'telmisartan'],
  amlodipine: ['bp', 'hypertension', 'pressure', 'heart'],
  telmisartan: ['bp', 'hypertension', 'pressure', 'heart'],
  budesonide: ['breathing', 'dyspnea', 'inhaler', 'respiratory'],
  missed: ['interruption', 'overdue', 'gap', 'lapsed'],
  interruption: ['missed', 'gap', 'overdue'],
  stopped: ['discontinued', 'paused', 'withheld', 'ceased', 'intolerance'],
  discontinued: ['stopped', 'paused', 'withheld', 'ceased', 'intolerance'],
  paused: ['withheld', 'stopped', 'discontinued', 'suspended', 'held'],
  withheld: ['paused', 'stopped', 'discontinued', 'held'],
  alt: ['sgpt', 'transaminase', 'aminotransferase'],
  ast: ['sgot', 'transaminase', 'aminotransferase'],
  sgpt: ['alt', 'transaminase', 'aminotransferase'],
  sgot: ['ast', 'transaminase', 'aminotransferase'],
  liver: ['hepatic', 'alt', 'ast', 'sgpt', 'sgot', 'bilirubin', 'jaundice', 'transaminase'],
  hepatic: ['liver', 'alt', 'ast', 'sgpt', 'sgot', 'bilirubin', 'jaundice', 'transaminase'],
  enzyme: ['transaminase', 'aminotransferase', 'alt', 'ast', 'sgpt', 'sgot', 'ggt'],
  enzymes: ['transaminase', 'aminotransferase', 'alt', 'ast', 'sgpt', 'sgot', 'ggt'],
  kidney: ['renal', 'creatinine', 'egfr', 'bun', 'urea'],
  renal: ['kidney', 'creatinine', 'egfr', 'bun', 'urea'],
  creatinine: ['egfr', 'renal', 'bun'],
  egfr: ['creatinine', 'renal'],
  troponin: ['ckmb', 'ck-mb', 'myocardial', 'infarction'],
  cholesterol: ['lipid', 'ldl', 'hdl', 'triglycerides', 'statin', 'atorvastatin'],
  lipid: ['cholesterol', 'ldl', 'hdl', 'triglycerides'],
  mri: ['magnetic', 'resonance', 'neuroimaging'],
  ct: ['tomography', 'radiology'],
};

// General medical semantic concept axes (32 dimensions) + 96 signed char n-gram hash dims = 128-d L2 vector
const CONCEPT_AXES: Array<{ id: string; terms: RegExp }> = [
  { id: 'dysglycemia', terms: /\b(high blood sugar|blood sugar|sugar|glucose|glycemic|dysglycemia|glycated|glycosylated|diabetes|diabetic|hba1c|ogtt|fbs|metformin|glimepiride|insulin)\b/gi },
  { id: 'dyspnea_resp', terms: /\b(breathing difficulty|shortness of breath|breathless|dyspnea|wheeze|respiratory|spirometry|fev1|inhaler|budesonide|silicosis|asthma|lung|pulmonary|cough)\b/gi },
  { id: 'cardiovascular', terms: /\b(heart medicine|cardiovascular|cardiac|heart|blood pressure|arterial tension|hypertension|mmhg|amlodipine|telmisartan|atorvastatin|statin|bp)\b/gi },
  { id: 'adherence_gap', terms: /\b(missed treatment|treatment interruption|interruption|missed|skipped|gap|overdue|lapsed|bridge|nonadherence)\b/gi },
  { id: 'discontinuation', terms: /\b(stopped medicine|discontinued|paused|withheld|ceased|held|suspended|stopped|intolerance|stop)\b/gi },
  { id: 'tb_dots', terms: /\b(tuberculosis|tb|dots|hrze|sputum|nikshay|pyridoxine)\b/gi },
  { id: 'malaria_vector', terms: /\b(malaria|vivax|plasmodium|mosquito|chloroquine|primaquine|g6pd|relapse)\b/gi },
  { id: 'bacterial_infection', terms: /\b(sore throat|throat|pharyngitis|tonsillitis|bacterial|antibiotic|azithromycin|amoxicillin|macrolide|infection)\b/gi },
  { id: 'antenatal_maternal', terms: /\b(pregnancy|pregnant|antenatal|trimester|gestational|ultrasound|obstetric|maternal|folic|calcium)\b/gi },
  { id: 'anemia_heme', terms: /\b(anemia|hemoglobin|hb|iron|ferrous|ifa|fatigue)\b/gi },
  { id: 'renal_kidney', terms: /\b(kidney|renal|creatinine|egfr|bun|urea|nephro|urinalysis|proteinuria)\b/gi },
  { id: 'ophthalmology', terms: /\b(eye|vision|blurred|fundoscopy|ophthalmology|cataract|retina)\b/gi },
  { id: 'allergy_adverse', terms: /\b(allergy|allergic|rash|urticaria|gastritis|reaction|contraindicated|penicillin|sulfonamide|ibuprofen)\b/gi },
  { id: 'follow_up_plan', terms: /\b(follow|followup|due|recheck|review|next|schedule|checkup)\b/gi },
  { id: 'migration_work', terms: /\b(migrate|migration|arrival|moved|sector|work|construction|textile|quarry|masonry|brick|dockyard|corridor)\b/gi },
  { id: 'imaging_diagnostics', terms: /\b(xray|x-ray|mri|ct\s+scan|chest\s+ct|head\s+ct|spirometry|ogtt|hba1c|ultrasound|fundoscopy)\b/gi },
  { id: 'musculoskeletal', terms: /\b(back|spine|lumbar|radiculopathy|pain|joint|injury)\b/gi },
  { id: 'hepatology', terms: /\b(liver|hepatic|alt|ast|sgpt|sgot|bilirubin|jaundice|transaminase|aminotransferase|ggt|lfts?)\b/gi },
  { id: 'cardiac_biomarkers', terms: /\b(troponin|ck-mb|ckmb|bnp|ecg|ekg|echocardiogram)\b/gi },
  { id: 'lipid_panel', terms: /\b(cholesterol|ldl|hdl|triglycerides|lipid\s+profile|lipid\s+panel)\b/gi },
];

const EMBED_DIM = 128;
const CONCEPT_OFFSET = 0;
const HASH_OFFSET = 32;
const HASH_BUCKETS = EMBED_DIM - HASH_OFFSET; // 96

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Lightweight 128-dimensional clinical semantic embedding (zero external API latency,
 * browser + server deterministic parity):
 * - Dims 0..31: Clinical concept axes capturing lay-to-clinical medical paraphrases
 * - Dims 32..127: L2-normalized signed character 3/4-gram subword projections
 */
export function embedClinicalText(text: string): Float64Array {
  const vec = new Float64Array(EMBED_DIM);
  const lower = text.toLowerCase();

  // 1. Concept projections (weighted 2.2 per matched concept axis so semantic concepts strongly align)
  for (let i = 0; i < CONCEPT_AXES.length && i < HASH_OFFSET; i++) {
    const rx = CONCEPT_AXES[i]!.terms;
    rx.lastIndex = 0;
    const matches = lower.match(rx);
    if (matches && matches.length > 0) {
      vec[CONCEPT_OFFSET + i] += Math.min(2.5, 1.4 + matches.length * 0.45);
    }
  }

  // 2. Signed character 3-gram & 4-gram feature hashing over normalized tokens
  const cleanTokens = lower.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  for (const tok of cleanTokens) {
    if (tok.length < 2) continue;
    const padded = `_${tok}_`;
    for (const gramSize of [3, 4]) {
      if (padded.length < gramSize) continue;
      for (let i = 0; i <= padded.length - gramSize; i++) {
        const gram = padded.slice(i, i + gramSize);
        const h = fnv1a32(gram);
        const bucket = HASH_OFFSET + (h % HASH_BUCKETS);
        const sign = (h & 1) === 0 ? 1 : -1;
        vec[bucket] += sign * 0.35;
      }
    }
  }

  // L2 normalize
  let normSq = 0;
  for (let i = 0; i < EMBED_DIM; i++) normSq += vec[i]! * vec[i]!;
  const norm = Math.sqrt(normSq);
  if (norm > 0) {
    for (let i = 0; i < EMBED_DIM; i++) vec[i] = vec[i]! / norm;
  }
  return vec;
}

export function cosineSimilarity(a: Float64Array, b: Float64Array): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) dot += a[i]! * b[i]!;
  return dot;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 || SHORT_CLINICAL_TOKENS.has(token));
}

function expandQueryTokens(tokens: string[]): string[] {
  const expanded = new Set<string>(tokens);
  for (const t of tokens) {
    const syns = CLINICAL_SYNONYMS[t];
    if (syns) {
      for (const s of syns) expanded.add(s);
    }
  }
  return Array.from(expanded);
}

function parseDateMs(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  const ms = Date.parse(dateStr);
  return Number.isFinite(ms) ? ms : 0;
}

export function detectPromptInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

export function sanitizeClinicalText(text: string): string {
  let cleaned = text.replace(/[<>]/g, '');
  for (const pattern of INJECTION_PATTERNS) {
    pattern.lastIndex = 0;
    cleaned = cleaned.replace(pattern, '[REDACTED_UNTRUSTED_DIRECTIVE]');
  }
  return cleaned.trim();
}

const ALLERGY_DRUG_CONTRAINDICATIONS: Array<{ allergyRx: RegExp; drugRx: RegExp; label: string }> = [
  {
    allergyRx: /penicillin/i,
    drugRx: /\b(penicillin|amoxicillin|ampicillin|amoxiclav|augmentin|piperacillin|cloxacillin)\b/i,
    label: 'Penicillin-class beta-lactam',
  },
  {
    allergyRx: /sulfonamide|sulfa\b/i,
    drugRx: /\b(sulfamethoxazole|cotrimoxazole|bactrim|septran|sulfadiazine|dapsone|sulfonamide)\b/i,
    label: 'Sulfonamide-class drug',
  },
  {
    allergyRx: /ibuprofen|nsaid/i,
    drugRx: /\b(ibuprofen|diclofenac|naproxen|ketorolac|aceclofenac|piroxicam|indomethacin)\b/i,
    label: 'NSAID',
  },
  {
    allergyRx: /metformin/i,
    drugRx: /\bmetformin\b/i,
    label: 'Metformin',
  },
];

function normalizeMedicationBase(med: string): string {
  return med
    .toLowerCase()
    .replace(/\b(discontinued|stopped|withheld|completed|due to.*)\b/gi, '')
    .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|units?|tabs?|tablets?|days?)\b/gi, '')
    .replace(/\b(od|bd|tds|hs|sr|fdc|daily|pack|bridge)\b/gi, '')
    .replace(/[^a-z\s-]/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(' ');
}

export function detectClinicalConflicts(patient: MigrantPatient): string[] {
  const conflicts: string[] = [];

  // 1. Allergy list internal contradictions + encounter note mismatches
  const lowerAllergies = patient.allergies.map((a) => a.toLowerCase());
  const hasNoneAllergy = lowerAllergies.some((a) => a.includes('none'));
  const hasSpecificAllergy = lowerAllergies.some((a) => !a.includes('none') && a.trim().length > 0);
  if (hasNoneAllergy && hasSpecificAllergy) {
    conflicts.push(
      `Allergy list contains contradictory entries (${patient.allergies.join(', ')}); verify allergy status directly with patient before prescribing.`,
    );
  }

  const encounterAllergyMentions = patient.encounters.filter((enc) =>
    /allerg(y|ic)|contraindicat|reaction/i.test(`${enc.diagnosis} ${enc.notes}`),
  );
  if (hasNoneAllergy && encounterAllergyMentions.length > 0) {
    conflicts.push(
      `Encounter ${encounterAllergyMentions.map((e) => e.encounterId).join(', ')} notes allergy/reaction concerns while summary lists "${patient.allergies.join(', ')}".`,
    );
  }

  // 2. Allergy-to-medication contraindications
  const activeMedPool: Array<{ source: string; med: string }> = [
    ...patient.activeMedications.map((m) => ({ source: 'Active Medications', med: m })),
    ...patient.encounters.flatMap((e) =>
      e.medications.map((m) => ({ source: e.encounterId, med: m })),
    ),
  ];
  for (const rule of ALLERGY_DRUG_CONTRAINDICATIONS) {
    if (patient.allergies.some((a) => rule.allergyRx.test(a))) {
      for (const item of activeMedPool) {
        if (
          rule.drugRx.test(item.med) &&
          !/discontinued|stopped|avoid|contraindicated|withheld/i.test(item.med)
        ) {
          conflicts.push(
            `Allergy-medication contraindication: documented allergy (${patient.allergies.join(', ')}) conflicts with ${rule.label} "${item.med}" in ${item.source}.`,
          );
        }
      }
    }
  }

  // 3. Duplicate encounters
  const seenEncSignatures = new Map<string, string>();
  for (const enc of patient.encounters) {
    const sig = `${enc.encounterDate}|${enc.facilityName.trim().toLowerCase()}|${enc.diagnosis.trim().toLowerCase()}`;
    const prevId = seenEncSignatures.get(sig);
    if (prevId && prevId !== enc.encounterId) {
      conflicts.push(
        `Duplicate encounter suspected: ${prevId} and ${enc.encounterId} share identical date (${enc.encounterDate}), facility (${enc.facilityName}), and diagnosis.`,
      );
    } else {
      seenEncSignatures.set(sig, enc.encounterId);
    }
  }

  // 4. Conflicting same-date diagnoses
  const byDate = new Map<string, typeof patient.encounters>();
  for (const enc of patient.encounters) {
    const list = byDate.get(enc.encounterDate) ?? [];
    list.push(enc);
    byDate.set(enc.encounterDate, list);
  }
  for (const [date, list] of byDate.entries()) {
    if (list.length > 1) {
      const distinctIcds = new Set(list.map((e) => e.icdCode.trim().toUpperCase()));
      const distinctDiags = new Set(list.map((e) => e.diagnosis.trim().toLowerCase()));
      if (distinctIcds.size > 1 || distinctDiags.size > 1) {
        conflicts.push(
          `Conflicting diagnoses recorded on identical date ${date}: ${list.map((e) => `${e.encounterId} (${e.diagnosis} [${e.icdCode}])`).join(' vs ')}.`,
        );
      }
    }
  }

  // 5. Contradictory medication records (discontinued in encounter yet active in summary)
  const discontinuedBases = new Set<string>();
  for (const enc of patient.encounters) {
    for (const m of enc.medications) {
      if (/\b(discontinued|stopped|withheld|contraindicated)\b/i.test(m)) {
        const base = normalizeMedicationBase(m);
        if (base) discontinuedBases.add(base);
      }
    }
    const noteMatch = enc.notes.match(
      /\b([a-z]{4,20})\s+(?:was\s+)?(?:discontinued|stopped|withheld|contraindicated)\b/i,
    );
    if (noteMatch?.[1]) {
      discontinuedBases.add(noteMatch[1].toLowerCase());
    }
  }
  for (const activeMed of patient.activeMedications) {
    const base = normalizeMedicationBase(activeMed);
    if (base && Array.from(discontinuedBases).some((d) => base.includes(d) || d.includes(base))) {
      conflicts.push(
        `Contradictory medication status: "${activeMed}" appears in Active Medications despite encounter documentation stating it was discontinued/stopped.`,
      );
    }
  }

  // 6. Identity-to-clinical attribute mismatches
  const obstetricMatch = patient.encounters.find(
    (e) =>
      e.encounterType === 'Antenatal' ||
      /^O\d|^Z3[347]/i.test(e.icdCode) ||
      /\b(antenatal|gestational|pregnancy|trimester|obstetric)\b/i.test(
        `${e.diagnosis} ${e.notes}`,
      ),
  );
  if (obstetricMatch && (patient.gender === 'Male' || patient.age < 12 || patient.age > 55)) {
    conflicts.push(
      `Identity-clinical mismatch: patient profile (${patient.age}y ${patient.gender}) conflicts with obstetric/antenatal encounter ${obstetricMatch.encounterId} (${obstetricMatch.diagnosis}).`,
    );
  }
  if (patient.age < 0 || patient.age > 120) {
    conflicts.push(`Invalid patient age (${patient.age}) detected in profile metadata.`);
  }

  // 7. Multi-state unlinked records
  if (patient.encounters.length > 1) {
    const distinctStates = new Set(patient.encounters.map((e) => e.state));
    const diagnoses = patient.encounters.map((e) => `${e.encounterId}: ${e.diagnosis}`);
    if (distinctStates.size > 1 && patient.recordLinkageStatus !== 'LINKED') {
      conflicts.push(
        `Multi-state encounters (${Array.from(distinctStates).join(' & ')}) exist under linkage status ${patient.recordLinkageStatus}: ${diagnoses.join(' | ')}.`,
      );
    }
  }

  return conflicts;
}

export interface RetrievalFilterOptions {
  stateFilter?: string;
  encounterTypeFilter?: ClinicalEncounter['encounterType'];
  minDate?: string;
}

function buildEncounterDocumentText(patient: MigrantPatient, enc: ClinicalEncounter): string {
  return [
    enc.facilityName,
    enc.district,
    enc.state,
    enc.encounterDate,
    enc.encounterType,
    enc.diagnosis,
    enc.icdCode,
    enc.medications.join(' '),
    enc.clinicianName,
    enc.sourceSystem,
    enc.followUpDueDate ? `follow up due ${enc.followUpDueDate}` : '',
    patient.allergies.join(' '),
    enc.notes,
  ].join(' ');
}

function formatChunk(enc: ClinicalEncounter, relevanceScore: number): RagSourceChunk {
  const followUpInfo = enc.followUpDueDate
    ? ` Follow-up due: ${enc.followUpDueDate}.`
    : enc.followUpRequired
      ? ' Follow-up required.'
      : '';

  return {
    chunkId: `CHK-${enc.encounterId}`,
    encounterId: enc.encounterId,
    title: sanitizeClinicalText(`${enc.encounterType} · ${enc.diagnosis} (${enc.icdCode})`),
    state: sanitizeClinicalText(`${enc.district}, ${enc.state}`),
    date: enc.encounterDate,
    excerpt: sanitizeClinicalText(
      `${enc.facilityName} (${enc.clinicianName}; ${enc.sourceSystem}): ${enc.notes} Medications: ${enc.medications.join(', ') || 'None'}.${followUpInfo}`,
    ),
    relevanceScore: Number(relevanceScore.toFixed(4)),
  };
}

function filterEncountersByMetadata(
  encounters: ClinicalEncounter[],
  filters?: RetrievalFilterOptions,
): ClinicalEncounter[] {
  return encounters.filter((enc) => {
    if (filters?.stateFilter && enc.state.toLowerCase() !== filters.stateFilter.toLowerCase()) {
      return false;
    }
    if (filters?.encounterTypeFilter && enc.encounterType !== filters.encounterTypeFilter) {
      return false;
    }
    if (filters?.minDate && parseDateMs(enc.encounterDate) < parseDateMs(filters.minDate)) {
      return false;
    }
    return true;
  });
}

function computeBm25Scores(
  queryTerms: string[],
  docsTokens: string[][],
  k1 = 1.2,
  b = 0.75,
): number[] {
  const N = docsTokens.length;
  if (N === 0) return [];
  const avgDl = docsTokens.reduce((sum, d) => sum + d.length, 0) / N || 1;

  // Document frequencies
  const dfMap = new Map<string, number>();
  for (const tokens of docsTokens) {
    const uniq = new Set(tokens);
    for (const t of uniq) {
      dfMap.set(t, (dfMap.get(t) ?? 0) + 1);
    }
  }

  return docsTokens.map((tokens) => {
    const tfMap = new Map<string, number>();
    for (const t of tokens) tfMap.set(t, (tfMap.get(t) ?? 0) + 1);
    const dl = tokens.length;
    let score = 0;
    const seenQ = new Set(queryTerms);
    for (const q of seenQ) {
      const tf = tfMap.get(q) ?? 0;
      if (tf === 0) continue;
      const df = dfMap.get(q) ?? 0;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      const denom = tf + k1 * (1 - b + b * (dl / avgDl));
      score += idf * ((tf * (k1 + 1)) / denom);
    }
    return score;
  });
}

/** Strategy A: Pure lexical overlap baseline (for Phase 5.2 comparative ablation) */
export function retrieveLexicalOnly(
  patient: MigrantPatient,
  query: string,
  topK: number = 4,
  filters?: RetrievalFilterOptions,
): RagSourceChunk[] {
  const candidates = filterEncountersByMetadata(patient.encounters, filters);
  const queryTokens = new Set(
    query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
  const chunks = candidates.map((enc, idx) => {
    const docTokens = buildEncounterDocumentText(patient, enc)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2);
    let overlap = 0;
    for (const tok of docTokens) {
      if (queryTokens.has(tok)) overlap += 1;
    }
    return formatChunk(enc, overlap + (candidates.length - idx) * 0.01);
  });
  return chunks.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, topK);
}

/** Strategy B: Synonym-expanded Okapi BM25 lexical retrieval */
export function retrieveSynonymBm25(
  patient: MigrantPatient,
  query: string,
  topK: number = 4,
  filters?: RetrievalFilterOptions,
): RagSourceChunk[] {
  const candidates = filterEncountersByMetadata(patient.encounters, filters);
  if (candidates.length === 0) return [];
  const rawTokens = tokenize(query);
  const expanded = expandQueryTokens(rawTokens);
  const docsTokens = candidates.map((enc) => tokenize(buildEncounterDocumentText(patient, enc)));
  const bm25Scores = computeBm25Scores(expanded, docsTokens);

  const chunks = candidates.map((enc, idx) => formatChunk(enc, bm25Scores[idx] ?? 0));
  return chunks.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, topK);
}

/** Strategy C: Hybrid BM25 + 128-d Clinical Semantic Embedding fused with Reciprocal Rank Fusion (RRF) */
export function retrieveHybridRrf(
  patient: MigrantPatient,
  query: string,
  topK: number = 4,
  filters?: RetrievalFilterOptions,
): RagSourceChunk[] {
  const candidates = filterEncountersByMetadata(patient.encounters, filters);
  if (candidates.length === 0) return [];

  const rawTokens = tokenize(query);
  const expanded = expandQueryTokens(rawTokens);
  const docsText = candidates.map((enc) => buildEncounterDocumentText(patient, enc));
  const docsTokens = docsText.map((txt) => tokenize(txt));
  const bm25Scores = computeBm25Scores(expanded, docsTokens);

  const qVec = embedClinicalText(query);
  const vecScores = docsText.map((txt) => cosineSimilarity(qVec, embedClinicalText(txt)));

  // Rank indices for BM25 and Vector cosine
  const bm25Order = candidates
    .map((_, i) => ({ i, s: bm25Scores[i] ?? 0 }))
    .sort((a, b) => b.s - a.s);
  const vecOrder = candidates
    .map((_, i) => ({ i, s: vecScores[i] ?? 0 }))
    .sort((a, b) => b.s - a.s);

  const bm25Rank = new Map<number, number>();
  const vecRank = new Map<number, number>();
  bm25Order.forEach((item, rank) => bm25Rank.set(item.i, rank + 1));
  vecOrder.forEach((item, rank) => vecRank.set(item.i, rank + 1));

  const RRF_K = 60;
  const chunks = candidates.map((enc, idx) => {
    const rrf = 1 / (RRF_K + (bm25Rank.get(idx) ?? 1)) + 1 / (RRF_K + (vecRank.get(idx) ?? 1));
    return formatChunk(enc, rrf);
  });
  return chunks.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, topK);
}

export const RETRIEVAL_ABSTENTION_THRESHOLD = 0.28;

export type MedicationStatusIntent =
  | 'CESSATION_CHANGE'
  | 'ACTIVE_PRESCRIBED'
  | 'NEGATED_CONTINUATION'
  | 'NONE';

export type TemporalOrderIntent = 'EARLIEST' | 'LATEST' | 'NONE';

export interface ClinicalQueryIntent {
  medicationStatusIntent: MedicationStatusIntent;
  temporalOrderIntent: TemporalOrderIntent;
  isRecencyQuery: boolean;
}

export interface EncounterMedicationStatusAnalysis {
  discontinuedMeds: string[];
  pausedMeds: string[];
  withheldMeds: string[];
  activePrescribedMeds: string[];
  hasCessationOrHold: boolean;
}

export type EvidenceStatus =
  | 'EVIDENCE_FOUND'
  | 'NORMAL_RESULT_DOCUMENTED'
  | 'MISSING_EVIDENCE';

export interface RetrievalReport {
  chunks: RagSourceChunk[];
  abstained: boolean;
  evidenceStatus: EvidenceStatus;
  abstentionReason: string | null;
  missingSubjectTerms: string[];
  queryIntent: ClinicalQueryIntent;
}

export interface RetrievalOptions extends RetrievalFilterOptions {
  strictAbstention?: boolean;
}

const DIAGNOSTIC_CONCEPT_AXES = new Set([
  'dysglycemia',
  'dyspnea_resp',
  'cardiovascular',
  'adherence_gap',
  'discontinuation',
  'tb_dots',
  'malaria_vector',
  'bacterial_infection',
  'antenatal_maternal',
  'anemia_heme',
  'renal_kidney',
  'ophthalmology',
  'allergy_adverse',
  'imaging_diagnostics',
  'musculoskeletal',
  'hepatology',
  'cardiac_biomarkers',
  'lipid_panel',
]);

export function classifyClinicalQueryIntent(query: string): ClinicalQueryIntent {
  const lower = query.toLowerCase();
  const hasNegatedStop =
    /\b(still\s+(?:taking|on|active)|not\s+(?:stopped|discontinued|paused|withheld)|never\s+(?:stopped|discontinued)|without\s+stopping|did(?:n't|\s+not)\s+stop|continued\s+taking)\b/i.test(
      lower,
    );
  const hasCessationTerms =
    /\b(stop|stopped|stopping|discontinue|discontinued|discontinuing|pause|paused|withhold|withheld|held|ceased|halt|halted|suspend|suspended|taken\s+off|why\s+was.*(?:off|removed|changed))\b/i.test(
      lower,
    );
  const hasActivePrescribedTerms =
    /\b(prescribed|started|initiated|initial\s+prescription|active\s+med|current\s+med|regimen|dosage|currently\s+on)\b/i.test(
      lower,
    );

  let medicationStatusIntent: MedicationStatusIntent = 'NONE';
  if (hasNegatedStop) {
    medicationStatusIntent = 'NEGATED_CONTINUATION';
  } else if (hasCessationTerms) {
    medicationStatusIntent = 'CESSATION_CHANGE';
  } else if (hasActivePrescribedTerms) {
    medicationStatusIntent = 'ACTIVE_PRESCRIBED';
  }

  const isEarliest = /\b(first|initial|earliest|originally|baseline|when\s+started|first\s+noted)\b/i.test(
    lower,
  );
  const isRecencyQuery = /\b(latest|recent|last|newest|most recent|next|upcoming|current)\b/i.test(
    lower,
  );
  const temporalOrderIntent: TemporalOrderIntent = isEarliest
    ? 'EARLIEST'
    : isRecencyQuery
      ? 'LATEST'
      : 'NONE';

  return {
    medicationStatusIntent,
    temporalOrderIntent,
    isRecencyQuery,
  };
}

export function analyzeEncounterMedicationStatus(
  enc: ClinicalEncounter,
): EncounterMedicationStatusAnalysis {
  const discontinuedMeds: string[] = [];
  const pausedMeds: string[] = [];
  const withheldMeds: string[] = [];
  const activePrescribedMeds: string[] = [];

  for (const med of enc.medications) {
    if (/\b(discontinued|stopped|ceased|terminated)\b/i.test(med)) {
      discontinuedMeds.push(med);
    } else if (/\b(paused|suspended|temporarily\s+held|held)\b/i.test(med)) {
      pausedMeds.push(med);
    } else if (/\b(withheld|contraindicated|avoid)\b/i.test(med)) {
      withheldMeds.push(med);
    } else {
      activePrescribedMeds.push(med);
    }
  }

  const noteAndDiag = `${enc.diagnosis} ${enc.notes}`;
  const clauses = noteAndDiag.split(/[.;\n]+/).map((s) => s.trim()).filter(Boolean);
  for (const clause of clauses) {
    if (/\b(discontinued|stopped|ceased)\b/i.test(clause)) {
      discontinuedMeds.push(clause);
    } else if (/\b(paused|suspended|held\s+pending|temporarily\s+held)\b/i.test(clause)) {
      pausedMeds.push(clause);
    } else if (/\b(withheld|contraindicated)\b/i.test(clause)) {
      withheldMeds.push(clause);
    }
  }

  return {
    discontinuedMeds,
    pausedMeds,
    withheldMeds,
    activePrescribedMeds,
    hasCessationOrHold:
      discontinuedMeds.length > 0 || pausedMeds.length > 0 || withheldMeds.length > 0,
  };
}

function countDiagnosticConceptMatches(queryLower: string, docLower: string): number {
  let shared = 0;
  for (const axis of CONCEPT_AXES) {
    if (!DIAGNOSTIC_CONCEPT_AXES.has(axis.id)) continue;
    axis.terms.lastIndex = 0;
    const qHit = axis.terms.test(queryLower);
    axis.terms.lastIndex = 0;
    const dHit = axis.terms.test(docLower);
    if (qHit && dHit) shared += 1;
  }
  return shared;
}

const SPECIFIC_BIOMARKER_SYNONYMS: Record<string, string[]> = {
  alt: ['alt', 'sgpt', 'alanine', 'transaminase', 'aminotransferase', 'lfts', 'lft'],
  ast: ['ast', 'sgot', 'aspartate', 'transaminase', 'aminotransferase', 'lfts', 'lft'],
  sgpt: ['sgpt', 'alt', 'alanine', 'transaminase', 'aminotransferase'],
  sgot: ['sgot', 'ast', 'aspartate', 'transaminase', 'aminotransferase'],
  bilirubin: ['bilirubin', 'jaundice', 'icterus'],
  creatinine: ['creatinine', 'egfr', 'bun'],
  egfr: ['egfr', 'creatinine'],
  troponin: ['troponin', 'ckmb', 'ck-mb'],
  cholesterol: ['cholesterol', 'ldl', 'hdl', 'triglycerides', 'lipid'],
  ldl: ['ldl', 'cholesterol', 'lipid'],
  hdl: ['hdl', 'cholesterol', 'lipid'],
  mri: ['mri', 'magnetic', 'neuroimaging'],
  xray: ['xray', 'x-ray', 'radiograph'],
  ct: ['ct', 'tomography'],
  tsh: ['tsh', 'thyroid', 'ft4', 't4', 'thyroxine'],
  alp: ['alp', 'alkaline'],
  ggt: ['ggt', 'gamma'],
  hba1c: ['hba1c', 'glycosylated', 'glycated', 'a1c'],
  glycosylated: ['hba1c', 'glycosylated', 'glycated', 'a1c'],
  glycated: ['hba1c', 'glycosylated', 'glycated', 'a1c'],
};

function hasSubwordStemOverlap(subjectTokens: string[], docTokens: string[]): number {
  let hits = 0;
  for (const q of subjectTokens) {
    if (q.length < 6) continue;
    const prefix = q.slice(0, 5);
    if (
      docTokens.some(
        (d) =>
          d.length >= 6 &&
          (d.startsWith(prefix) || q.startsWith(d.slice(0, 5))),
      )
    ) {
      hits += 1;
    }
  }
  return hits;
}

/**
 * Strategy D (Production Default) with Query Intent, Status Change Prioritization & Calibrated Abstention:
 * Hybrid BM25 + Clinical Embeddings + RRF + Evidence Relevance + Medication Status Reranking.
 */
export function retrieveClinicalContextWithReport(
  patient: MigrantPatient,
  query: string,
  topK: number = 4,
  options?: RetrievalOptions,
): RetrievalReport {
  const queryIntent = classifyClinicalQueryIntent(query);
  const candidates = filterEncountersByMetadata(patient.encounters, options);
  if (candidates.length === 0) {
    return {
      chunks: [],
      abstained: true,
      evidenceStatus: 'MISSING_EVIDENCE',
      abstentionReason: 'No encounters match the active filter or consent scope.',
      missingSubjectTerms: tokenize(query).filter((t) => !GENERIC_QUERY_TOKENS.has(t)),
      queryIntent,
    };
  }

  const rawTokens = tokenize(query);
  const subjectTokens = rawTokens.filter((t) => !GENERIC_QUERY_TOKENS.has(t));
  const expanded = expandQueryTokens(rawTokens);
  const expandedSubject = expandQueryTokens(subjectTokens);

  const sortedByDateAsc = [...candidates].sort(
    (a, b) => parseDateMs(a.encounterDate) - parseDateMs(b.encounterDate),
  );
  const dateRankById = new Map<string, number>();
  sortedByDateAsc.forEach((enc, idx) => dateRankById.set(enc.encounterId, idx + 1));

  const docsText = candidates.map((enc) => buildEncounterDocumentText(patient, enc));
  const docsTokens = docsText.map((txt) => tokenize(txt));
  const bm25Scores = computeBm25Scores(expanded, docsTokens);
  const subjectBm25Scores = computeBm25Scores(expandedSubject, docsTokens);
  const maxBm25 = Math.max(0.0001, ...bm25Scores);

  const qVec = embedClinicalText(query);
  const vecScores = docsText.map((txt) => cosineSimilarity(qVec, embedClinicalText(txt)));

  const bm25Order = candidates
    .map((_, i) => ({ i, s: bm25Scores[i] ?? 0 }))
    .sort((a, b) => b.s - a.s);
  const vecOrder = candidates
    .map((_, i) => ({ i, s: vecScores[i] ?? 0 }))
    .sort((a, b) => b.s - a.s);

  const bm25Rank = new Map<number, number>();
  const vecRank = new Map<number, number>();
  bm25Order.forEach((item, rank) => bm25Rank.set(item.i, rank + 1));
  vecOrder.forEach((item, rank) => vecRank.set(item.i, rank + 1));

  const RRF_K = 60;
  const queryLower = query.toLowerCase();
  const askedInvestigations = subjectTokens.filter((t) => t in SPECIFIC_BIOMARKER_SYNONYMS);

  const scored = candidates.map((enc, idx) => {
    const docLower = docsText[idx]!.toLowerCase();
    const docTokenList = docsTokens[idx]!;
    const docTokenSet = new Set(docTokenList);
    const subjectBm25 = subjectBm25Scores[idx] ?? 0;
    const bm25Norm = (bm25Scores[idx] ?? 0) > 0 ? (bm25Scores[idx] ?? 0) / maxBm25 : 0;
    const vecSim = Math.max(0, vecScores[idx] ?? 0);
    const rrf = 1 / (RRF_K + (bm25Rank.get(idx) ?? 1)) + 1 / (RRF_K + (vecRank.get(idx) ?? 1));
    const rrfNorm = rrf * 30; // ~0.5..1.0 scale

    // Metadata entity alignment bonus (state, district, icdCode, encounterDate, clinician)
    let metadataBoost = 0;
    if (queryLower.includes(enc.state.toLowerCase())) metadataBoost += 0.25;
    if (queryLower.includes(enc.district.toLowerCase())) metadataBoost += 0.25;
    if (queryLower.includes(enc.icdCode.toLowerCase())) metadataBoost += 0.35;
    if (queryLower.includes(enc.encounterDate)) metadataBoost += 0.3;

    const diagnosticConceptHits = countDiagnosticConceptMatches(queryLower, docLower);
    const subwordStemHits = hasSubwordStemOverlap(subjectTokens, docTokenList);

    // Strip negative ordering phrases ("no liver function panel ordered", "troponin not done") before testing biomarker presence
    const affirmativeDocLower = docLower.replace(
      /\bno\s+(?:[a-z]+\s+){0,4}(?:panel|test|lab|labs|mri|ct|xray|scan|values?|levels?)\s+(?:ordered|done|performed|recorded|available)\b/gi,
      ' ',
    );
    const affirmativeTokenSet = new Set(tokenize(affirmativeDocLower));

    // Investigation specificity guard: if query asks for specific lab/imaging (e.g., ALT/AST, MRI, Troponin),
    // verify the encounter actually mentions that biomarker/modality affirmatively (not broad organ mentions or negative orders).
    let investigationDomainMatched = true;
    if (askedInvestigations.length > 0) {
      investigationDomainMatched = askedInvestigations.some((inv) => {
        const strictSyns = SPECIFIC_BIOMARKER_SYNONYMS[inv] ?? [inv];
        return strictSyns.some((term) => affirmativeTokenSet.has(term));
      });
    }

    // Check genuine evidence match (prevents RRF baseline floor from turning unrelated chunks into false positives)
    const isPureTemporalQuery =
      subjectTokens.length === 0 && queryIntent.temporalOrderIntent !== 'NONE';
    const hasSubjectEvidence =
      isPureTemporalQuery ||
      metadataBoost > 0 ||
      (investigationDomainMatched &&
        (subjectBm25 > 0 || diagnosticConceptHits > 0 || subwordStemHits > 0));

    // Medication status & temporal alignment boosts
    const medStatus = analyzeEncounterMedicationStatus(enc);
    let statusBoost = 0;
    if (hasSubjectEvidence && queryIntent.medicationStatusIntent === 'CESSATION_CHANGE') {
      const cessationText = [
        ...medStatus.discontinuedMeds,
        ...medStatus.pausedMeds,
        ...medStatus.withheldMeds,
      ]
        .join(' ')
        .toLowerCase();
      const cessationTokens = new Set(tokenize(cessationText));
      const matchedSubjectInCessation = expandedSubject.some((t) => cessationTokens.has(t));
      if (medStatus.hasCessationOrHold && (matchedSubjectInCessation || subjectTokens.length === 0)) {
        statusBoost += 0.48;
      } else if (medStatus.hasCessationOrHold) {
        statusBoost += 0.32;
      } else {
        // Pure initial prescription without status change remains historical context (#2), behind cessation encounter (#1)
        statusBoost -= 0.08;
      }
    } else if (hasSubjectEvidence && queryIntent.medicationStatusIntent === 'NEGATED_CONTINUATION') {
      const activeText = medStatus.activePrescribedMeds.join(' ').toLowerCase();
      const activeTokens = new Set(tokenize(activeText));
      const matchedActive = expandedSubject.some((t) => activeTokens.has(t));
      if (medStatus.hasCessationOrHold && !matchedActive) {
        statusBoost -= 0.25;
      } else if (matchedActive || medStatus.activePrescribedMeds.length > 0) {
        statusBoost += 0.32;
      }
    } else if (hasSubjectEvidence && queryIntent.medicationStatusIntent === 'ACTIVE_PRESCRIBED') {
      if (!medStatus.hasCessationOrHold && medStatus.activePrescribedMeds.length > 0) {
        statusBoost += 0.18;
      }
    }

    const chronologicalRank = dateRankById.get(enc.encounterId) ?? 1;
    let temporalBoost = 0;
    if (
      queryIntent.temporalOrderIntent === 'EARLIEST' &&
      queryIntent.medicationStatusIntent !== 'CESSATION_CHANGE'
    ) {
      const earlinessRank = candidates.length - chronologicalRank + 1;
      temporalBoost = (earlinessRank / Math.max(1, candidates.length)) * 0.16;
    } else {
      const recencyWeight = queryIntent.isRecencyQuery ? 0.35 : 0.04;
      temporalBoost = (chronologicalRank / Math.max(1, candidates.length)) * recencyWeight;
    }

    let rerankScore: number;
    if (!hasSubjectEvidence) {
      // Unrelated encounter: cap score strictly below RETRIEVAL_ABSTENTION_THRESHOLD
      rerankScore = Math.min(0.18, 0.08 * vecSim + temporalBoost * 0.25);
    } else {
      const conceptBonus = Math.min(0.24, diagnosticConceptHits * 0.12);
      const stemBonus = Math.min(0.24, subwordStemHits * 0.14);
      rerankScore =
        0.42 * bm25Norm +
        0.45 * vecSim +
        0.2 * rrfNorm +
        conceptBonus +
        stemBonus +
        metadataBoost +
        statusBoost +
        temporalBoost;
    }

    const hasExplicitNormalResult =
      hasSubjectEvidence &&
      /\b(normal|within\s+normal\s+limits|wnl|unremarkable|g6pd\s+normal)\b/i.test(docLower);

    return {
      enc,
      score: rerankScore,
      passesAbstention:
        hasSubjectEvidence && rerankScore >= RETRIEVAL_ABSTENTION_THRESHOLD,
      hasExplicitNormalResult,
      chunk: formatChunk(enc, rerankScore),
    };
  });

  scored.sort((a, b) => b.score - a.score);
  const passing = scored.filter((item) => item.passesAbstention);

  // Calibrated abstention: if ZERO encounters clear subject/threshold evidence, return empty chunks!
  if (passing.length === 0) {
    return {
      chunks: [],
      abstained: true,
      evidenceStatus: 'MISSING_EVIDENCE',
      abstentionReason:
        subjectTokens.length > 0
          ? `No linked encounter records clinical evidence for: ${subjectTokens.join(', ')}.`
          : 'No relevant clinical evidence matched the query above the calibrated threshold.',
      missingSubjectTerms: subjectTokens,
      queryIntent,
    };
  }

  const selectedItems = options?.strictAbstention
    ? passing.slice(0, topK)
    : [
        ...passing,
        ...scored.filter((item) => !item.passesAbstention),
      ].slice(0, topK);

  const anyExplicitNormal = passing.some((item) => item.hasExplicitNormalResult);

  return {
    chunks: selectedItems.map((item) => item.chunk),
    abstained: false,
    evidenceStatus: anyExplicitNormal ? 'NORMAL_RESULT_DOCUMENTED' : 'EVIDENCE_FOUND',
    abstentionReason: null,
    missingSubjectTerms: [],
    queryIntent,
  };
}

export function retrieveClinicalContext(
  patient: MigrantPatient,
  query: string,
  topK: number = 4,
  filters?: RetrievalFilterOptions,
): RagSourceChunk[] {
  return retrieveClinicalContextWithReport(patient, query, topK, filters).chunks;
}

export interface ContextFormatOptions {
  consentRestricted?: boolean;
}

export function formatPatientContextForPrompt(
  patient: MigrantPatient,
  chunks: RagSourceChunk[],
  options?: ContextFormatOptions,
): string {
  const isRestricted =
    Boolean(options?.consentRestricted) ||
    patient.originState.toLowerCase().startsWith('withheld') ||
    patient.originDistrict.toLowerCase() === 'withheld';

  const conflicts = detectClinicalConflicts(patient);
  const corridorLine = isRestricted
    ? `Care Scope: Local State Only (${sanitizeClinicalText(patient.currentDistrict)}, ${sanitizeClinicalText(patient.currentState)}) — Origin location withheld by patient inter-state consent | Linkage: ${patient.recordLinkageStatus}`
    : `Migration Corridor: ${sanitizeClinicalText(patient.originDistrict)}, ${sanitizeClinicalText(patient.originState)} -> ${sanitizeClinicalText(patient.currentDistrict)}, ${sanitizeClinicalText(patient.currentState)} | Linkage: ${patient.recordLinkageStatus}`;

  const migrationLines = isRestricted
    ? patient.migrationHistory
        .filter((m) => m.state.toLowerCase() === patient.currentState.toLowerCase())
        .map(
          (m) =>
            `${sanitizeClinicalText(m.arrivalDate)}: ${sanitizeClinicalText(m.district)}, ${sanitizeClinicalText(m.state)} (${sanitizeClinicalText(m.sector)})`,
        )
        .join(' -> ') || 'Origin migration trajectory withheld pending inter-state sharing consent.'
    : patient.migrationHistory.length > 0
      ? patient.migrationHistory
          .map(
            (m) =>
              `${sanitizeClinicalText(m.arrivalDate)}: ${sanitizeClinicalText(m.district)}, ${sanitizeClinicalText(m.state)} (${sanitizeClinicalText(m.sector)})`,
          )
          .join(' -> ')
      : 'None documented';

  const header = [
    `Patient: ${sanitizeClinicalText(patient.fullName)} (Health ID: ${sanitizeClinicalText(patient.healthId)}, Age: ${patient.age}, Sex: ${sanitizeClinicalText(patient.gender)}, Blood Group: ${sanitizeClinicalText(patient.bloodGroup)})`,
    corridorLine,
    `Migration History: ${migrationLines}`,
    `Primary Language: ${sanitizeClinicalText(patient.primaryLanguage)} | Sector: ${sanitizeClinicalText(patient.occupationSector)}`,
    `Chronic/Active Conditions: ${patient.chronicConditions.map(sanitizeClinicalText).join(', ') || 'None'}`,
    `Allergies: ${patient.allergies.map(sanitizeClinicalText).join(', ') || 'None reported'}`,
    `Active Medications: ${patient.activeMedications.map(sanitizeClinicalText).join(', ') || 'None'}`,
    `Medication Gap: ${patient.medicationGapDays} days | Days Since Last Visit: ${patient.daysSinceLastVisit} days`,
  ].join('\n');

  const conflictSection =
    conflicts.length > 0
      ? `\n\nDETECTED RECORD CONFLICTS:\n${conflicts.map((c) => `- ${sanitizeClinicalText(c)}`).join('\n')}`
      : '';

  const retrieved =
    chunks.length > 0
      ? chunks
          .map((c) => `[${c.encounterId}] (${c.date} | ${c.state}) ${c.title}\n  ${c.excerpt}`)
          .join('\n\n')
      : 'RETRIEVAL ABSTENTION: No linked clinical encounters contain evidence matching the queried laboratory test, imaging, or clinical topic under active consent. Do NOT infer or report a normal result when evidence is absent; state explicitly that it is not recorded in the linked encounters.';

  let formatted = `<CLINICAL_EVIDENCE>\n${header}${conflictSection}\n\nRETRIEVED CLINICAL ENCOUNTERS:\n${retrieved}\n</CLINICAL_EVIDENCE>`;
  if (isRestricted) {
    const termsToScrub = [patient.originState, patient.originDistrict]
      .map((t) => t.trim())
      .filter(
        (t) =>
          t.length >= 3 &&
          t.toLowerCase() !== patient.currentState.toLowerCase() &&
          t.toLowerCase() !== patient.currentDistrict.toLowerCase() &&
          !t.toLowerCase().startsWith('withheld'),
      );
    for (const term of termsToScrub) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      formatted = formatted.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '[Withheld Origin]');
    }
  }
  return formatted;
}

export type ClaimStatus =
  | 'SUPPORTED'
  | 'ABSTENTION'
  | 'UNRELATED_CITATION'
  | 'UNSUPPORTED_CLAIM'
  | 'INVALID_CITATION'
  | 'CONTRADICTORY_EVIDENCE';

export interface VerifiedClaimResult {
  claimText: string;
  citedEncounterIds: string[];
  supportingEncounterIds: string[];
  status: ClaimStatus;
  entailmentScore: number;
  reason: string;
}

export interface ClaimVerificationReport {
  claims: VerifiedClaimResult[];
  validCitations: string[];
  invalidCitations: string[];
  unrelatedCitations: string[];
  unsupportedClaims: number;
  contradictoryClaims: number;
  supportedRate: number;
  sanitizedAnswer: string;
}

function extractSalientEntities(text: string): { numbersAndCodes: string[]; tokens: string[] } {
  const withoutCitations = text.replace(/\[(?:UNVERIFIED_REF:)?ENC-[A-Za-z0-9_-]+\]/g, ' ');
  const numMatches =
    withoutCitations.match(/\b(?:[A-Z]\d{2}(?:\.\d+)?|\d{4}-\d{2}-\d{2}|\d+(?:\.\d+)?(?:\/\d+)?%?)\b/g) ??
    [];
  const tokens = tokenize(withoutCitations).filter(
    (t) =>
      ![
        'patient',
        'recorded',
        'linked',
        'encounter',
        'encounters',
        'documented',
        'clinic',
        'visit',
        'history',
        'noted',
        'status',
        'shows',
        'stated',
        'continue',
        'verify',
      ].includes(t),
  );
  return {
    numbersAndCodes: numMatches.map((m) => m.toLowerCase()),
    tokens,
  };
}

function countSharedConceptAxes(textA: string, textB: string): number {
  const lowA = textA.toLowerCase();
  const lowB = textB.toLowerCase();
  let shared = 0;
  for (const axis of CONCEPT_AXES) {
    axis.terms.lastIndex = 0;
    const hitA = axis.terms.test(lowA);
    axis.terms.lastIndex = 0;
    const hitB = axis.terms.test(lowB);
    if (hitA && hitB) shared += 1;
  }
  return shared;
}

function computeClaimChunkSupport(
  claimText: string,
  chunk: RagSourceChunk,
): { score: number; missingNumbers: string[] } {
  const cleanClaim = claimText.replace(/\[(?:UNVERIFIED_REF:)?ENC-[A-Za-z0-9_-]+\]/g, ' ').trim();
  const chunkText = `${chunk.date} ${chunk.state} ${chunk.title} ${chunk.excerpt}`.toLowerCase();
  const { numbersAndCodes, tokens } = extractSalientEntities(cleanClaim);

  const missingNumbers = numbersAndCodes.filter((num) => !chunkText.includes(num));
  const chunkTokenSet = new Set(tokenize(chunkText));
  const expandedClaim = expandQueryTokens(tokens);
  const matchedTokens = expandedClaim.filter((t) => chunkTokenSet.has(t));
  const sharedConcepts = countSharedConceptAxes(cleanClaim, chunkText);

  if (matchedTokens.length === 0 && sharedConcepts === 0) {
    return { score: 0, missingNumbers };
  }

  const lexicalCov = tokens.length > 0 ? Math.min(1, matchedTokens.length / Math.min(3, tokens.length)) : 0;
  const semanticCos = Math.max(0, cosineSimilarity(embedClinicalText(cleanClaim), embedClinicalText(chunkText)));
  const conceptBonus = Math.min(0.2, sharedConcepts * 0.12);
  const score = Number(
    (0.45 * semanticCos + 0.5 * lexicalCov + conceptBonus - missingNumbers.length * 0.3).toFixed(3),
  );
  return { score, missingNumbers };
}

/**
 * Deterministic claim-level evidence & citation entailment verifier.
 * Extracts individual clinical claims, verifies whether cited encounters exist AND
 * actually contain supporting facts/numbers, detects unrelated/unsupported/contradictory claims,
 * and marks insufficient claims inline.
 */
export function verifyClaimsAgainstEvidence(
  answer: string,
  chunks: RagSourceChunk[],
  patient?: MigrantPatient,
): ClaimVerificationReport {
  const allowedIds = chunks.map((c) => c.encounterId);
  const citationSweep = validateRagCitations(answer, allowedIds);
  const chunkById = new Map<string, RagSourceChunk>(chunks.map((c) => [c.encounterId, c]));
  const conflicts = patient ? detectClinicalConflicts(patient) : [];

  const protectedAnswer = citationSweep.sanitizedAnswer.replace(
    /\b(Dr|Mr|Mrs|Ms|St|P|M|S|E|vs|approx|e\.g|i\.e)\.\s+(?=[A-Za-z])/g,
    '$1.<ABBR_DOT> ',
  );
  const rawSentences = protectedAnswer
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/<ABBR_DOT>/g, '').replace(/^[-*\d.)\s]+/, '').trim())
    .filter((s) => s.length >= 6);

  const claims: VerifiedClaimResult[] = [];
  const unrelatedCitations = new Set<string>();
  let unsupportedClaims = 0;
  let contradictoryClaims = 0;
  let factualClaimCount = 0;
  let supportedFactualCount = 0;
  const annotatedLines: string[] = [];

  for (const sentence of rawSentences) {
    const isAbstention =
      /\b(not recorded|not documented|absent from|no record|cannot confirm|insufficient evidence|withheld|not available|no\s+(?:[a-z]+\s+){0,4}(?:values?|results?|labs?|imaging|records?)\s+(?:were\s+)?(?:recorded|documented|found|available))\b/i.test(
        sentence,
      );
    const isAdvisoryBoilerplate =
      /^(please\s+)?(verify|consult|review|seek|note:|disclaimer)/i.test(sentence) &&
      extractSalientEntities(sentence).numbersAndCodes.length === 0 &&
      !/\b(mg|diagnosis|diagnosed|prescribed|allergy)\b/i.test(sentence);

    const citeMatches = sentence.match(/\[(ENC-[A-Za-z0-9_-]+)\]/g) ?? [];
    const citedIds = Array.from(new Set(citeMatches.map((c) => c.slice(1, -1))));
    const hadUnverifiedRef = /\[UNVERIFIED_REF:([A-Za-z0-9_-]+)\]/.test(sentence);

    if (isAbstention) {
      claims.push({
        claimText: sentence,
        citedEncounterIds: citedIds,
        supportingEncounterIds: [],
        status: 'ABSTENTION',
        entailmentScore: 1,
        reason: 'Explicit abstention acknowledging missing or withheld evidence.',
      });
      annotatedLines.push(sentence);
      continue;
    }

    if (isAdvisoryBoilerplate && citedIds.length === 0 && !hadUnverifiedRef) {
      annotatedLines.push(sentence);
      continue;
    }

    factualClaimCount += 1;

    // Score against all retrieved chunks to identify best actual supporting encounters
    const chunkEvaluations = chunks.map((ch) => ({
      id: ch.encounterId,
      ...computeClaimChunkSupport(sentence, ch),
    }));
    const supportingIds = chunkEvaluations
      .filter((ev) => ev.score >= 0.28 && ev.missingNumbers.length === 0)
      .map((ev) => ev.id);

    // Check summary-level patient allergies/demographics if sentence states patient allergy/blood group
    const summaryText = patient
      ? `${patient.fullName} ${patient.bloodGroup} ${patient.allergies.join(' ')} ${patient.chronicConditions.join(' ')} ${patient.activeMedications.join(' ')}`.toLowerCase()
      : '';
    const summaryTokens = new Set(tokenize(summaryText));
    const claimEntities = extractSalientEntities(sentence);
    const summaryTokenMatches = claimEntities.tokens.filter((t) => summaryTokens.has(t));
    const summaryMatched =
      Boolean(summaryText) &&
      summaryTokenMatches.length >= Math.min(2, Math.max(1, claimEntities.tokens.length)) &&
      claimEntities.numbersAndCodes.every((n) => summaryText.includes(n));

    // Check contradictions: advising an allergen-contraindicated or discontinued drug positively without warning,
    // or claiming "no allergies" when allergies are documented
    let contradictionFound = false;
    if (patient) {
      const suggestsSafe = /\b(safe(?:ly)?\s+to\s+take|can\s+safe(?:ly)?\s+take|safe(?:ly)?\s+take|can\s+continue|prescribe|administer|recommended|start|continue)\b/i.test(sentence);
      const warns = /\b(avoid|contraindicat|conflict|discontinued|stopped|do not|never|verify|warning|allergy)\b/i.test(
        sentence,
      );
      if (suggestsSafe && !warns) {
        for (const rule of ALLERGY_DRUG_CONTRAINDICATIONS) {
          if (patient.allergies.some((a) => rule.allergyRx.test(a)) && rule.drugRx.test(sentence)) {
            contradictionFound = true;
          }
        }
        // Check against discontinued medications in encounters
        for (const enc of patient.encounters) {
          for (const med of enc.medications) {
            if (/\b(discontinued|stopped|withheld|contraindicated)\b/i.test(med)) {
              const base = normalizeMedicationBase(med);
              if (base && sentence.toLowerCase().includes(base)) {
                contradictionFound = true;
              }
            }
          }
        }
      }
      const hasDocumentedAllergy = patient.allergies.some(
        (a) => a.trim().length > 0 && !/\bnone\b/i.test(a),
      );
      if (
        hasDocumentedAllergy &&
        /\b(no\s+(?:known\s+)?allergies|allergy[- ]free|without\s+allergies)\b/i.test(sentence)
      ) {
        contradictionFound = true;
      }
    }

    if (contradictionFound) {
      contradictoryClaims += 1;
      claims.push({
        claimText: sentence,
        citedEncounterIds: citedIds,
        supportingEncounterIds: supportingIds,
        status: 'CONTRADICTORY_EVIDENCE',
        entailmentScore: 0,
        reason: 'Claim recommends therapy that conflicts with documented allergy or discontinuation conflict.',
      });
      annotatedLines.push(`${sentence} [CONFLICT_ALERT: verify allergy/medication conflict]`);
      continue;
    }

    if (hadUnverifiedRef && citedIds.length === 0) {
      unsupportedClaims += 1;
      claims.push({
        claimText: sentence,
        citedEncounterIds: [],
        supportingEncounterIds: supportingIds,
        status: 'INVALID_CITATION',
        entailmentScore: 0,
        reason: 'Referenced encounter ID does not exist in retrieved evidence.',
      });
      annotatedLines.push(sentence);
      continue;
    }

    if (citedIds.length > 0) {
      const citedEvaluations = citedIds.map((id) => {
        const ch = chunkById.get(id);
        return ch ? { id, ...computeClaimChunkSupport(sentence, ch) } : { id, score: 0, missingNumbers: ['missing'] };
      });
      const bestCited = citedEvaluations.sort((a, b) => b.score - a.score)[0]!;
      if (bestCited.score >= 0.22 && bestCited.missingNumbers.length === 0) {
        supportedFactualCount += 1;
        claims.push({
          claimText: sentence,
          citedEncounterIds: citedIds,
          supportingEncounterIds: supportingIds.length ? supportingIds : [bestCited.id],
          status: 'SUPPORTED',
          entailmentScore: bestCited.score,
          reason: `Verified against cited encounter ${bestCited.id}.`,
        });
        annotatedLines.push(sentence);
      } else {
        for (const id of citedIds) unrelatedCitations.add(id);
        unsupportedClaims += 1;
        claims.push({
          claimText: sentence,
          citedEncounterIds: citedIds,
          supportingEncounterIds: supportingIds,
          status: 'UNRELATED_CITATION',
          entailmentScore: bestCited.score,
          reason:
            bestCited.missingNumbers.length > 0
              ? `Cited ${bestCited.id} lacks factual values [${bestCited.missingNumbers.join(', ')}]${supportingIds.length ? `; matching record: ${supportingIds.join(', ')}` : ''}.`
              : `Cited ${bestCited.id} does not entail the clinical claim.`,
        });
        annotatedLines.push(`${sentence} [UNVERIFIED_CITATION: ${bestCited.id} does not support claim]`);
      }
      continue;
    }

    // No citation attached
    if (supportingIds.length > 0 || summaryMatched) {
      supportedFactualCount += 1;
      claims.push({
        claimText: sentence,
        citedEncounterIds: [],
        supportingEncounterIds: supportingIds,
        status: 'SUPPORTED',
        entailmentScore: 0.4,
        reason: supportingIds.length
          ? `Grounded in retrieved encounter ${supportingIds.join(', ')} (citation omitted).`
          : 'Grounded in patient demographic/allergy summary.',
      });
      annotatedLines.push(sentence);
    } else {
      unsupportedClaims += 1;
      claims.push({
        claimText: sentence,
        citedEncounterIds: [],
        supportingEncounterIds: [],
        status: 'UNSUPPORTED_CLAIM',
        entailmentScore: 0,
        reason: 'Insufficient evidence in retrieved encounters or patient summary.',
      });
      annotatedLines.push(`${sentence} [UNVERIFIED_CLAIM]`);
    }
  }

  return {
    claims,
    validCitations: citationSweep.validCitations,
    invalidCitations: citationSweep.invalidCitations,
    unrelatedCitations: Array.from(unrelatedCitations),
    unsupportedClaims,
    contradictoryClaims,
    supportedRate:
      factualClaimCount > 0 ? Number((supportedFactualCount / factualClaimCount).toFixed(4)) : 1,
    sanitizedAnswer: annotatedLines.join(' ').trim() || citationSweep.sanitizedAnswer,
  };
}

/**
 * Validates that encounter ID citations ([ENC-...] or bare ENC-...) in an LLM
 * response belong strictly to the supplied retrieved encounter set.
 */
export function validateRagCitations(
  answer: string,
  allowedEncounterIds: string[],
): {
  validCitations: string[];
  invalidCitations: string[];
  sanitizedAnswer: string;
} {
  const allowedSet = new Set(allowedEncounterIds);
  const validCitations = new Set<string>();
  const invalidCitations = new Set<string>();

  const sanitized = answer.replace(
    /\[?(ENC-[A-Za-z0-9_-]+)\]?/g,
    (fullMatch, id: string, offset: number, source: string) => {
      const prefix = source.slice(Math.max(0, offset - 16), offset);
      if (prefix.endsWith('UNVERIFIED_REF:')) {
        return fullMatch;
      }
      if (allowedSet.has(id)) {
        validCitations.add(id);
        return fullMatch;
      }
      invalidCitations.add(id);
      return `[UNVERIFIED_REF:${id}]`;
    },
  );

  return {
    validCitations: Array.from(validCitations),
    invalidCitations: Array.from(invalidCitations),
    sanitizedAnswer: sanitized,
  };
}
