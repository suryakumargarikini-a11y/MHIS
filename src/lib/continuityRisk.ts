import type { ContinuityRiskResult, MigrantPatient, RiskFactorBreakdown, RiskTier } from '../types/health.ts';

const CONDITION_CATEGORIES: { category: string; keywords: string[] }[] = [
  { category: 'Tuberculosis', keywords: ['tuberculosis', 'tb', 'dots'] },
  { category: 'Maternal / Antenatal', keywords: ['gestational', 'antenatal', 'pregnancy'] },
  { category: 'HIV', keywords: ['hiv'] },
  { category: 'Vector-Borne', keywords: ['malaria', 'dengue'] },
  { category: 'Cardiometabolic', keywords: ['hypertension', 'diabetes'] },
  { category: 'Occupational Respiratory', keywords: ['silicosis', 'asthma', 'copd'] },
];

export interface RiskSimulationOverride {
  medicationGapDays?: number;
  daysSinceLastVisit?: number;
  interstateTransitActive?: boolean;
  unlinkedExternalRecords?: boolean;
}

function clampNonNegativeDays(value: unknown, max: number = 3650): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(max, Math.round(value)));
}

/**
 * Documented heuristic specification for the Continuity-of-Care Risk Engine.
 * Experimental triage heuristic ONLY — not clinically validated and non-diagnostic.
 */
export const CONTINUITY_RISK_MODEL_SPEC = {
  version: 'MHIS-HEURISTIC-v1',
  validated: false,
  diagnosticUsePermitted: false,
  maxScore: 100,
  dimensions: [
    {
      name: 'Medication Continuity Gap',
      maxPoints: 35,
      thresholds: '14+ days = 35 pts; 7-13 days = 24 pts; 3-6 days = 12 pts; <3 days = 0 pts',
    },
    {
      name: 'Overdue Clinical Follow-up',
      maxPoints: 25,
      thresholds:
        'overdueDays = max(0, daysSinceLastVisit - followUpTarget); >=21d = 25 pts; >=7d = 16 pts; >0d = 8 pts',
    },
    {
      name: 'Condition Care-Continuity Sensitivity',
      maxPoints: 20,
      thresholds: '10 pts per distinct high-interruptibility category matched (capped at 20 pts)',
    },
    {
      name: 'Interstate Transit & Record Fragmentation',
      maxPoints: 20,
      thresholds: '10 pts if originState != currentState; +10 pts if recordLinkageStatus != LINKED',
    },
  ],
  tiers: { LOW: '0-29', MODERATE: '30-59', HIGH: '60-100' },
  assumptionsAndLimitations: [
    'Weights reflect prototype public-health triage judgment, not regression coefficients from clinical outcome cohorts.',
    'Non-finite, negative, and extreme day inputs are clamped to [0, 3650] to guarantee bounded deterministic outputs.',
    'Condition matching relies on keyword presence in recorded chronicConditions and does not parse severity or lab biomarkers.',
    'Outputs must be reviewed by a licensed clinician and never used autonomously for diagnosis or prescribing.',
  ],
} as const;

/**
 * Computes transparent, deterministic continuity-of-care risk score (0-100)
 * using bounded inputs and category-deduplicated chronic sensitivity weights.
 * Note: This is a deterministic prototype heuristic, NOT a clinically validated predictive score.
 */
export function assessContinuityRisk(
  patient: MigrantPatient,
  override?: RiskSimulationOverride,
): ContinuityRiskResult {
  const medGap = clampNonNegativeDays(
    override?.medicationGapDays ?? patient.medicationGapDays,
  );
  const daysSinceVisit = clampNonNegativeDays(
    override?.daysSinceLastVisit ?? patient.daysSinceLastVisit,
  );
  const followUpTarget = Math.max(
    1,
    clampNonNegativeDays(patient.recommendedFollowUpDays, 365) || 14,
  );
  const isInterstate =
    override?.interstateTransitActive ?? patient.originState !== patient.currentState;
  const isUnlinked =
    override?.unlinkedExternalRecords ?? patient.recordLinkageStatus !== 'LINKED';

  const factors: RiskFactorBreakdown[] = [];

  // 1. Medication adherence / refill gap (0-35 pts)
  let medPoints = 0;
  if (medGap >= 14) medPoints = 35;
  else if (medGap >= 7) medPoints = 24;
  else if (medGap >= 3) medPoints = 12;
  factors.push({
    factor: 'Medication Continuity Gap',
    points: medPoints,
    maxPoints: 35,
    rationale:
      medGap > 0
        ? `${medGap} days since scheduled refill or DOTS dose window.`
        : 'Active prescriptions within adherence window.',
  });

  // 2. Follow-up interval overdue (0-25 pts)
  const overdueDays = Math.max(0, daysSinceVisit - followUpTarget);
  let followUpPoints = 0;
  if (overdueDays >= 21) followUpPoints = 25;
  else if (overdueDays >= 7) followUpPoints = 16;
  else if (overdueDays > 0) followUpPoints = 8;
  factors.push({
    factor: 'Overdue Clinical Follow-up',
    points: followUpPoints,
    maxPoints: 25,
    rationale:
      overdueDays > 0
        ? `${overdueDays} days past ${followUpTarget}-day follow-up threshold.`
        : `Within ${followUpTarget}-day follow-up interval.`,
  });

  // 3. Condition fragility (0-20 pts), deduplicated across clinical categories
  const lowerConds = patient.chronicConditions.map((c) => c.toLowerCase());
  const matchedCategories = new Set<string>();
  for (const cond of lowerConds) {
    for (const group of CONDITION_CATEGORIES) {
      if (group.keywords.some((kw) => cond.includes(kw))) {
        matchedCategories.add(group.category);
      }
    }
  }
  const criticalHits = matchedCategories.size;
  const conditionPoints = Math.min(20, criticalHits * 10);
  factors.push({
    factor: 'Condition Care-Continuity Sensitivity',
    points: conditionPoints,
    maxPoints: 20,
    rationale:
      criticalHits > 0
        ? `${criticalHits} treatment-sensitive condition category(s): ${Array.from(matchedCategories).join(', ')}.`
        : 'No high-interruptibility chronic regimens flagged.',
  });

  // 4. Interstate migration & record fragmentation (0-20 pts)
  const transitPoints = isInterstate ? 10 : 0;
  const linkagePoints = isUnlinked ? 10 : 0;
  const migrationPoints = transitPoints + linkagePoints;
  factors.push({
    factor: 'Interstate Transit & Record Fragmentation',
    points: migrationPoints,
    maxPoints: 20,
    rationale: `${isInterstate ? `Active corridor ${patient.originState} -> ${patient.currentState}` : 'Single-state residence'}; linkage status: ${patient.recordLinkageStatus}.`,
  });

  const score = Math.min(
    100,
    factors.reduce((sum, item) => sum + item.points, 0),
  );

  let tier: RiskTier = 'LOW';
  let recommendedAction = 'Routine portable follow-up via QR pass at destination PHC.';
  if (score >= 60) {
    tier = 'HIGH';
    recommendedAction =
      'Urgent destination ASHA/clinic outreach within 48 hours; verify refill continuity and link external records.';
  } else if (score >= 30) {
    tier = 'MODERATE';
    recommendedAction =
      'Schedule telehealth or destination clinic check-in within 7 days and issue multilingual medication reminder.';
  }

  return {
    score,
    tier,
    factors,
    recommendedAction,
    methodologyNote:
      'Experimental deterministic heuristic (not clinically validated). Designed to surface follow-up, medication-gap, and record-linkage triage signals for clinician review.',
  };
}
