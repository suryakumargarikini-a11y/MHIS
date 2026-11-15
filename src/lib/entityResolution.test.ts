import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_PATIENTS } from '../data/syntheticPatients.ts';
import {
  evaluateEntityResolution,
  jaroWinklerSimilarity,
  normalizeClinicalName,
} from './entityResolution.ts';

test('normalizeClinicalName unifies common Indian transliteration variants', () => {
  assert.equal(normalizeClinicalName('Mohd. Irfan Ansari'), normalizeClinicalName('Mohammad Irfan Ansari'));
  assert.equal(normalizeClinicalName('Seeta Devi'), normalizeClinicalName('Sita Devi'));
});

test('jaroWinklerSimilarity scores high for minor spelling variations', () => {
  const sim = jaroWinklerSimilarity('rames kumar mahto', 'ramesh kumar mahato');
  assert.ok(sim > 0.9, `Expected >0.9 similarity, got ${sim}`);
});

test('evaluateEntityResolution detects cross-state duplicate migrant registration', () => {
  const matches = evaluateEntityResolution(
    {
      fullName: 'Rames Kumar Mahto',
      age: 35,
      gender: 'Male',
      originState: 'Bihar',
      currentState: 'Maharashtra',
      phoneLast4: '4821',
    },
    INITIAL_PATIENTS,
  );
  assert.ok(matches.length > 0);
  assert.equal(matches[0].patient.healthId, 'MHIS-BR-MH-1042');
  assert.ok(matches[0].similarityScore >= 0.85);
});
