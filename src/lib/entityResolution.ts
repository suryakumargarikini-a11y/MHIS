import type { LinkageCandidate, LinkageMatchSignal, MigrantPatient } from '../types/health.ts';

export interface IncomingRegistrationCandidate {
  fullName: string;
  age: number;
  gender: 'Female' | 'Male' | 'Other';
  originState: string;
  currentState: string;
  phoneLast4: string;
  facilityName?: string;
  externalRefId?: string;
}

/**
 * Normalizes transliterated Indian names for phonetic comparison
 * (e.g., Mohammad/Mohammed/Mohd, Sita/Seeta, Ramesh/Rames).
 */
export function normalizeClinicalName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z\s]/g, '')
    .replace(/\bmohd\b/g, 'mohammad')
    .replace(/\bmuhammad\b/g, 'mohammad')
    .replace(/\bmohammed\b/g, 'mohammad')
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/aa/g, 'a')
    .replace(/sh/g, 's')
    .replace(/bh/g, 'b')
    .replace(/dh/g, 'd')
    .replace(/th/g, 't')
    .replace(/ph/g, 'f')
    .replace(/\s+/g, ' ');
}

/**
 * Computes Jaro-Winkler similarity (0.0 to 1.0) between two strings.
 */
export function jaroWinklerSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const matchDistance = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  const jaro =
    (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;

  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }

  return Number((jaro + prefix * 0.1 * (1 - jaro)).toFixed(4));
}

export interface PatientResolutionMatch {
  patient: MigrantPatient;
  similarityScore: number;
  recommendation: 'AUTO_LINK' | 'CLINICIAN_REVIEW' | 'DISTINCT_PATIENT';
  signals: LinkageMatchSignal[];
}

/**
 * Evaluates a candidate registration or external clinic record against existing unified patients.
 */
export function evaluateEntityResolution(
  candidate: IncomingRegistrationCandidate,
  existingPatients: MigrantPatient[],
): PatientResolutionMatch[] {
  const normCandidate = normalizeClinicalName(candidate.fullName);
  const results: PatientResolutionMatch[] = [];

  for (const patient of existingPatients) {
    const normExisting = normalizeClinicalName(patient.fullName);
    const nameSim = jaroWinklerSimilarity(normCandidate, normExisting);
    const signals: LinkageMatchSignal[] = [];
    let score = 0;

    // 1. Phonetic + Jaro-Winkler Name Match (max 0.50)
    const nameWeight = Number((nameSim * 0.5).toFixed(3));
    score += nameWeight;
    if (nameSim >= 0.72) {
      signals.push({
        signal: 'Phonetic Name Similarity',
        weight: Math.round(nameSim * 100),
        matchedValue: `${patient.fullName} (${Math.round(nameSim * 100)}%)`,
      });
    }

    // 2. Origin State Match (max 0.18)
    if (patient.originState.toLowerCase() === candidate.originState.toLowerCase()) {
      score += 0.18;
      signals.push({
        signal: 'Home Origin State',
        weight: 18,
        matchedValue: patient.originState,
      });
    }

    // 3. Phone Last-4 Suffix Match (max 0.20)
    if (candidate.phoneLast4.trim() && patient.phoneLast4 === candidate.phoneLast4.trim()) {
      score += 0.2;
      signals.push({
        signal: 'Phone Suffix (Last 4)',
        weight: 20,
        matchedValue: `•••• ${patient.phoneLast4}`,
      });
    }

    // 4. Age Proximity within +/- 2 years (max 0.12)
    const ageDiff = Math.abs(patient.age - candidate.age);
    if (ageDiff <= 2 && patient.gender === candidate.gender) {
      const ageWeight = ageDiff === 0 ? 0.12 : 0.08;
      score += ageWeight;
      signals.push({
        signal: 'Age & Sex Cohort',
        weight: Math.round(ageWeight * 100),
        matchedValue: `${patient.age}y ${patient.gender}`,
      });
    }

    const boundedScore = Number(Math.min(0.99, score).toFixed(2));
    if (boundedScore >= 0.58) {
      const recommendation =
        boundedScore >= 0.86
          ? 'AUTO_LINK'
          : boundedScore >= 0.68
            ? 'CLINICIAN_REVIEW'
            : 'DISTINCT_PATIENT';

      results.push({
        patient,
        similarityScore: boundedScore,
        recommendation,
        signals,
      });
    }
  }

  return results.sort((a, b) => b.similarityScore - a.similarityScore);
}

export function buildLinkageCandidate(
  candidate: IncomingRegistrationCandidate,
  match: PatientResolutionMatch,
): LinkageCandidate {
  return {
    candidateId: `LNK-${Date.now().toString(36).toUpperCase()}`,
    incomingRecordRef: candidate.externalRefId || `EXT-${Math.floor(1000 + Math.random() * 9000)}`,
    incomingFacility: candidate.facilityName || `${candidate.currentState} Outreach Clinic`,
    incomingState: candidate.currentState,
    incomingName: candidate.fullName,
    incomingAge: candidate.age,
    incomingOriginState: candidate.originState,
    incomingPhoneLast4: candidate.phoneLast4,
    matchedHealthId: match.patient.healthId,
    matchedPatientName: match.patient.fullName,
    similarityScore: match.similarityScore,
    recommendation: match.recommendation,
    signals: match.signals,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  };
}
