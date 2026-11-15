import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_CONSENTS, INITIAL_PATIENTS } from '../data/syntheticPatients.ts';
import { applyInterStateConsent, filterSurveillancePatients } from './consentGuard.ts';

test('applyInterStateConsent redacts external-state encounters when interStateSharing is false for doctors', () => {
  const savitri = INITIAL_PATIENTS.find((p) => p.healthId === 'MHIS-RJ-MH-6720')!;
  const savitriConsent = INITIAL_CONSENTS['MHIS-RJ-MH-6720'];
  assert.equal(savitriConsent.interStateSharing, false);

  const doctorView = applyInterStateConsent(savitri, savitriConsent, 'doctor');
  assert.equal(doctorView.consentRestricted, true);
  assert.equal(doctorView.withheldEncounterCount, 1);
  assert.equal(doctorView.patient.encounters.length, 0);
  assert.equal(doctorView.patient.activeMedications.length, 0);
  assert.ok(doctorView.restrictionReason?.includes('revoked'));
});

test('applyInterStateConsent allows patient principal to view their own full timeline', () => {
  const savitri = INITIAL_PATIENTS.find((p) => p.healthId === 'MHIS-RJ-MH-6720')!;
  const savitriConsent = INITIAL_CONSENTS['MHIS-RJ-MH-6720'];
  const selfView = applyInterStateConsent(savitri, savitriConsent, 'patient');
  assert.equal(selfView.consentRestricted, false);
  assert.equal(selfView.patient.encounters.length, savitri.encounters.length);
});

test('filterSurveillancePatients excludes profiles with anonymizedSurveillance=false', () => {
  const optedIn = filterSurveillancePatients(INITIAL_PATIENTS, INITIAL_CONSENTS);
  const optedInIds = optedIn.map((p) => p.healthId);
  assert.equal(optedInIds.includes('MHIS-OD-GJ-2089'), false);
  assert.equal(optedInIds.includes('MHIS-JH-TN-5591'), false);
  assert.equal(optedInIds.includes('MHIS-RJ-MH-6720'), false);
  assert.equal(optedInIds.includes('MHIS-BR-MH-1042'), true);
});

test('applyInterStateConsent scrubs external-state medications, conditions, migration history, and origin location even when local encounters exist', () => {
  const ramesh = INITIAL_PATIENTS[0]; // Has 1 Bihar encounter + 1 Maharashtra encounter
  const revokedConsent = {
    ...INITIAL_CONSENTS[ramesh.healthId],
    interStateSharing: false,
  };
  const view = applyInterStateConsent(ramesh, revokedConsent, 'doctor');
  assert.equal(view.consentRestricted, true);
  assert.equal(view.withheldEncounterCount, 1);
  assert.equal(view.patient.encounters.length, 1);
  assert.equal(view.patient.encounters[0].state, 'Maharashtra');
  assert.equal(view.patient.originDistrict, 'Withheld');
  assert.ok(view.patient.originState.startsWith('Withheld'));
  assert.deepEqual(view.patient.externalRefIds, []);
  assert.equal(view.patient.activeMedications.includes('Pyridoxine 20mg'), false);
  assert.equal(view.patient.migrationHistory.some((m) => m.state === 'Bihar'), false);
  assert.equal(view.patient.chronicConditions.includes('Mild Anemia'), false);
});


