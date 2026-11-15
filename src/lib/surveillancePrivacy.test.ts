import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_CONSENTS, INITIAL_PATIENTS } from '../data/syntheticPatients.ts';
import {
  buildPrivacyPreservingSurveillanceReport,
  SURVEILLANCE_PRIVACY_POLICY,
} from './surveillancePrivacy.ts';

test('TASK 3: Surveillance excludes opted-out profiles, masks interStateSharing=false origins, suppresses k<3 cohorts, and emits zero PII', () => {
  const report = buildPrivacyPreservingSurveillanceReport(INITIAL_PATIENTS, INITIAL_CONSENTS);

  assert.equal(report.policyVersion, SURVEILLANCE_PRIVACY_POLICY.version);
  assert.equal(report.minimumCohortSize, 3);
  assert.equal(report.totalRegisteredPatients, 6);
  // In INITIAL_CONSENTS: Ramesh, Irfan, Bikash have anonymizedSurveillance=true (3); Sunita, Lakshmi, Kishan = false (3)
  assert.equal(report.optedInCount, 3);
  assert.equal(report.excludedOptOutCount, 3);
  assert.equal(report.suppressedCorridorCount, 3);

  const serialized = JSON.stringify(report);
  // Zero direct PII
  for (const patient of INITIAL_PATIENTS) {
    assert.equal(serialized.includes(patient.fullName), false);
    assert.equal(serialized.includes(patient.healthId), false);
    assert.equal(serialized.includes(patient.originDistrict), false);
  }
  // Opted-out Rajasthan corridor must NEVER appear
  assert.equal(serialized.includes('Rajasthan'), false);
  assert.equal(serialized.includes('Odisha'), false);
  assert.equal(serialized.includes('Jharkhand'), false);
  // Individual k=1 corridor names must be generalized/suppressed
  assert.equal(serialized.includes('Bihar -> Maharashtra'), false);
  assert.equal(serialized.includes('Uttar Pradesh -> Delhi NCR'), false);
});

test('TASK 3: Surveillance respects interStateSharing=false even when anonymizedSurveillance=true and publishes corridors once k >= 3', () => {
  // Construct 3 Bihar -> Maharashtra patients (2 interStateSharing=true, 1 interStateSharing=false)
  const cohort = [0, 1, 2, 3].map((idx) => ({
    ...INITIAL_PATIENTS[0],
    healthId: `MHIS-SURV-${idx}`,
    fullName: `Worker ${idx}`,
  }));
  const consents = {
    'MHIS-SURV-0': { ...INITIAL_CONSENTS['MHIS-BR-MH-1042'], healthId: 'MHIS-SURV-0', interStateSharing: true, anonymizedSurveillance: true },
    'MHIS-SURV-1': { ...INITIAL_CONSENTS['MHIS-BR-MH-1042'], healthId: 'MHIS-SURV-1', interStateSharing: true, anonymizedSurveillance: true },
    'MHIS-SURV-2': { ...INITIAL_CONSENTS['MHIS-BR-MH-1042'], healthId: 'MHIS-SURV-2', interStateSharing: true, anonymizedSurveillance: true },
    // 4th worker opted into surveillance BUT revoked inter-state origin sharing!
    'MHIS-SURV-3': { ...INITIAL_CONSENTS['MHIS-BR-MH-1042'], healthId: 'MHIS-SURV-3', interStateSharing: false, anonymizedSurveillance: true },
  };

  const report = buildPrivacyPreservingSurveillanceReport(cohort, consents);
  assert.equal(report.optedInCount, 4);
  assert.equal(report.originMaskedByConsentCount, 1);
  // Bihar -> Maharashtra has 3 consented records (published), while the 1 interStateSharing=false record is suppressed (<3) and never merges into Bihar -> Maharashtra
  const publishable = report.corridors.find((c) => c.corridorKey === 'Bihar -> Maharashtra');
  assert.ok(publishable);
  assert.equal(publishable.suppressed, false);
  assert.equal(publishable.totalCount, 3);
  assert.equal(report.suppressedCorridorCount, 1);
});
