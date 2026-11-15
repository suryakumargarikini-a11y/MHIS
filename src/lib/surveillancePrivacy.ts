import type { ConsentPreferences, MigrantPatient, RiskTier } from '../types/health.ts';
import { assessContinuityRisk } from './continuityRisk.ts';
import { applyInterStateConsent } from './consentGuard.ts';

export const DEFAULT_MIN_SURVEILLANCE_COHORT = 3;

export const SURVEILLANCE_PRIVACY_POLICY = {
  version: 'MHIS-SURV-POLICY-v1',
  minimumCohortSize: DEFAULT_MIN_SURVEILLANCE_COHORT,
  requireExplicitSurveillanceOptIn: true,
  respectInterStateSharingConsent: true,
  prohibitPiiInAggregates: true,
  prohibitedFields: [
    'fullName',
    'healthId',
    'phoneLast4',
    'externalRefIds',
    'originDistrict',
    'currentDistrict',
    'facilityName',
    'clinicianName',
  ] as const,
  legalBasisSummary:
    'Aggregate public-health surveillance strictly includes only patients with explicit anonymizedSurveillance=true opt-in, masks origin states when interStateSharing=false, strips all direct identifiers, and suppresses subgroups smaller than k=3 to prevent corridor re-identification.',
} as const;

export interface SurveillanceCorridorAggregate {
  corridorKey: string;
  originState: string | null;
  destinationState: string;
  suppressed: boolean;
  totalCount: number | null;
  highRiskCount: number | null;
  unlinkedCount: number | null;
  displayCount: string;
}

export interface SurveillanceStateAggregate {
  state: string;
  suppressed: boolean;
  destinationCount: number | null;
  displayCount: string;
}

export interface SurveillanceSectorAggregate {
  sector: string;
  suppressed: boolean;
  count: number | null;
  displayCount: string;
}

export interface PrivacyPreservingSurveillanceReport {
  policyVersion: string;
  minimumCohortSize: number;
  totalRegisteredPatients: number;
  optedInCount: number;
  excludedOptOutCount: number;
  originMaskedByConsentCount: number;
  suppressedCorridorCount: number;
  corridors: SurveillanceCorridorAggregate[];
  destinationStates: SurveillanceStateAggregate[];
  sectors: SurveillanceSectorAggregate[];
  riskDistribution: Record<RiskTier, number | null>;
  canPublishRiskBreakdown: boolean;
}

/**
 * Generates de-identified, consent-governed, k-anonymity-suppressed aggregate
 * public-health surveillance metrics.
 *
 * Enforces:
 * 1. Explicit `anonymizedSurveillance === true` opt-in (fail-closed if missing).
 * 2. Respects `interStateSharing === false` so aggregation never reveals restricted origin states.
 * 3. Suppresses small cells (`0 < n < minCohortSize`, default k = 3) and generalizes small corridors.
 * 4. Emits zero PII (`fullName`, `healthId`, `facilityName`, `originDistrict`, `currentDistrict`).
 */
export function buildPrivacyPreservingSurveillanceReport(
  patients: MigrantPatient[],
  consents: Record<string, ConsentPreferences>,
  options?: { minCohortSize?: number },
): PrivacyPreservingSurveillanceReport {
  const minK = Math.max(2, options?.minCohortSize ?? DEFAULT_MIN_SURVEILLANCE_COHORT);

  const optedInPatients = patients.filter(
    (p) => consents[p.healthId]?.anonymizedSurveillance === true,
  );
  const excludedOptOutCount = patients.length - optedInPatients.length;

  let originMaskedByConsentCount = 0;

  const corridorRaw = new Map<
    string,
    { originState: string | null; destinationState: string; total: number; highRisk: number; unlinked: number }
  >();
  const destRaw = new Map<string, number>();
  const sectorRaw = new Map<string, number>();
  const riskCounts: Record<RiskTier, number> = { LOW: 0, MODERATE: 0, HIGH: 0 };

  for (const patient of optedInPatients) {
    const consent = consents[patient.healthId];
    const interStateAllowed = consent?.interStateSharing === true;
    // Apply consent guard so origin/external conditions never bypass consent into risk tiering
    const scoped = applyInterStateConsent(patient, consent, 'admin').patient;
    const risk = assessContinuityRisk(scoped);
    riskCounts[risk.tier] += 1;

    destRaw.set(patient.currentState, (destRaw.get(patient.currentState) ?? 0) + 1);
    sectorRaw.set(patient.occupationSector, (sectorRaw.get(patient.occupationSector) ?? 0) + 1);

    let corridorKey: string;
    let originLabel: string | null;
    if (!interStateAllowed) {
      originMaskedByConsentCount += 1;
      originLabel = null;
      corridorKey = `Origin Withheld (Consent) -> ${patient.currentState}`;
    } else {
      originLabel = patient.originState;
      corridorKey = `${patient.originState} -> ${patient.currentState}`;
    }

    const prev = corridorRaw.get(corridorKey) ?? {
      originState: originLabel,
      destinationState: patient.currentState,
      total: 0,
      highRisk: 0,
      unlinked: 0,
    };
    prev.total += 1;
    if (risk.tier === 'HIGH') prev.highRisk += 1;
    if (patient.recordLinkageStatus !== 'LINKED') prev.unlinked += 1;
    corridorRaw.set(corridorKey, prev);
  }

  let suppressedCorridorCount = 0;
  const unsuppressedCorridors: SurveillanceCorridorAggregate[] = [];
  let suppressedPoolTotal = 0;
  let suppressedPoolHighRisk = 0;
  let suppressedPoolUnlinked = 0;

  for (const [key, bucket] of corridorRaw.entries()) {
    if (bucket.total < minK) {
      suppressedCorridorCount += 1;
      suppressedPoolTotal += bucket.total;
      suppressedPoolHighRisk += bucket.highRisk;
      suppressedPoolUnlinked += bucket.unlinked;
    } else {
      unsuppressedCorridors.push({
        corridorKey: key,
        originState: bucket.originState,
        destinationState: bucket.destinationState,
        suppressed: false,
        totalCount: bucket.total,
        highRiskCount: bucket.highRisk,
        unlinkedCount: bucket.unlinked,
        displayCount: String(bucket.total),
      });
    }
  }

  unsuppressedCorridors.sort((a, b) => (b.totalCount ?? 0) - (a.totalCount ?? 0));

  if (suppressedCorridorCount > 0) {
    // Generalized rollup bucket: reveals exact corridor names only if pool >= minK, still masks all route names
    const canShowPoolTotal = suppressedPoolTotal >= minK;
    unsuppressedCorridors.push({
      corridorKey: `Generalized Small Corridors (< ${minK} profiles each, ${suppressedCorridorCount} route(s))`,
      originState: null,
      destinationState: 'Multiple / Generalized',
      suppressed: true,
      totalCount: canShowPoolTotal ? suppressedPoolTotal : null,
      highRiskCount: canShowPoolTotal && suppressedPoolHighRisk >= minK ? suppressedPoolHighRisk : null,
      unlinkedCount: canShowPoolTotal && suppressedPoolUnlinked >= minK ? suppressedPoolUnlinked : null,
      displayCount: canShowPoolTotal
        ? `${suppressedPoolTotal} pooled (routes suppressed)`
        : `< ${minK} (Suppressed)`,
    });
  }

  const destinationStates: SurveillanceStateAggregate[] = Array.from(destRaw.entries())
    .map(([state, count]) =>
      count < minK
        ? {
            state,
            suppressed: true,
            destinationCount: null,
            displayCount: `< ${minK} (Suppressed)`,
          }
        : {
            state,
            suppressed: false,
            destinationCount: count,
            displayCount: String(count),
          },
    )
    .sort((a, b) => (b.destinationCount ?? 0) - (a.destinationCount ?? 0));

  const sectors: SurveillanceSectorAggregate[] = Array.from(sectorRaw.entries())
    .map(([sector, count]) =>
      count < minK
        ? {
            sector,
            suppressed: true,
            count: null,
            displayCount: `< ${minK} (Suppressed)`,
          }
        : {
            sector,
            suppressed: false,
            count,
            displayCount: String(count),
          },
    )
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));

  const canPublishRiskBreakdown = optedInPatients.length >= minK;

  return {
    policyVersion: SURVEILLANCE_PRIVACY_POLICY.version,
    minimumCohortSize: minK,
    totalRegisteredPatients: patients.length,
    optedInCount: optedInPatients.length,
    excludedOptOutCount,
    originMaskedByConsentCount,
    suppressedCorridorCount,
    corridors: unsuppressedCorridors,
    destinationStates,
    sectors,
    riskDistribution: canPublishRiskBreakdown
      ? {
          LOW: riskCounts.LOW > 0 && riskCounts.LOW < minK ? null : riskCounts.LOW,
          MODERATE: riskCounts.MODERATE > 0 && riskCounts.MODERATE < minK ? null : riskCounts.MODERATE,
          HIGH: riskCounts.HIGH > 0 && riskCounts.HIGH < minK ? null : riskCounts.HIGH,
        }
      : { LOW: null, MODERATE: null, HIGH: null },
    canPublishRiskBreakdown,
  };
}
