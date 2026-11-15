import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_PATIENTS } from '../data/syntheticPatients.ts';
import { assessContinuityRisk } from './continuityRisk.ts';

test('assessContinuityRisk flags high risk for DOTS TB patient with medication gap and interstate move', () => {
  const ramesh = INITIAL_PATIENTS[0]; // MHIS-BR-MH-1042
  const result = assessContinuityRisk(ramesh);
  assert.equal(result.tier, 'HIGH');
  assert.ok(result.score >= 60);
  assert.equal(result.factors.length, 4);
  assert.ok(result.methodologyNote?.includes('not clinically validated'));
});

test('assessContinuityRisk reports low risk for adherent linked diabetic patient', () => {
  const bikash = INITIAL_PATIENTS[3]; // MHIS-WB-KA-4402
  const result = assessContinuityRisk(bikash);
  assert.equal(result.tier, 'LOW');
  assert.ok(result.score < 30);
});

test('assessContinuityRisk respects interactive clinical simulation overrides', () => {
  const bikash = INITIAL_PATIENTS[3];
  const simulated = assessContinuityRisk(bikash, {
    medicationGapDays: 18,
    daysSinceLastVisit: 60,
    unlinkedExternalRecords: true,
  });
  assert.equal(simulated.tier, 'HIGH');
  assert.ok(simulated.score >= 60);
});

test('assessContinuityRisk clamps NaN, Infinity, and negative inputs safely', () => {
  const base = {
    ...INITIAL_PATIENTS[3],
    recommendedFollowUpDays: 0,
  };
  const result = assessContinuityRisk(base, {
    medicationGapDays: Number.NaN,
    daysSinceLastVisit: -45,
  });
  assert.equal(Number.isFinite(result.score), true);
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.equal(result.factors[0].points, 0);

  const infResult = assessContinuityRisk(base, {
    medicationGapDays: Number.POSITIVE_INFINITY,
    daysSinceLastVisit: Number.NEGATIVE_INFINITY,
  });
  assert.equal(Number.isFinite(infResult.score), true);
  assert.equal(infResult.factors[0].points, 0);
});

test('assessContinuityRisk deduplicates synonymous chronic condition categories', () => {
  const duplicatedConditionsPatient = {
    ...INITIAL_PATIENTS[3],
    chronicConditions: ['Pulmonary Tuberculosis (TB)', 'DOTS Continuation Category-I'],
  };
  const res = assessContinuityRisk(duplicatedConditionsPatient);
  const conditionFactor = res.factors.find((f) => f.factor === 'Condition Care-Continuity Sensitivity');
  assert.ok(conditionFactor);
  // Both strings belong to Tuberculosis category -> should count once (10 pts), not twice (20 pts)
  assert.equal(conditionFactor.points, 10);
});

test('assessContinuityRisk is deterministic across repeated evaluations', () => {
  const patient = INITIAL_PATIENTS[1];
  const first = assessContinuityRisk(patient, { medicationGapDays: 9, daysSinceLastVisit: 25 });
  const second = assessContinuityRisk(patient, { medicationGapDays: 9, daysSinceLastVisit: 25 });
  assert.deepEqual(first, second);
});
