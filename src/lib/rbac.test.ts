import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_BOOTSTRAP_EMAIL,
  canAccessPatientRecord,
  canAccessRoute,
  isBootstrapAdminEmail,
  resolveEffectiveRole,
} from './rbac.ts';

test('isBootstrapAdminEmail requires verified email match', () => {
  assert.equal(isBootstrapAdminEmail(ADMIN_BOOTSTRAP_EMAIL, true), true);
  assert.equal(isBootstrapAdminEmail(ADMIN_BOOTSTRAP_EMAIL.toUpperCase(), true), true);
  assert.equal(isBootstrapAdminEmail(ADMIN_BOOTSTRAP_EMAIL, false), false);
  assert.equal(isBootstrapAdminEmail('other@example.com', true), false);
});

test('resolveEffectiveRole prevents client self-promotion to admin or doctor', () => {
  assert.equal(
    resolveEffectiveRole({
      isAuthenticated: true,
      email: 'user@example.com',
      emailVerified: true,
      firestoreRole: null,
      sandboxRole: 'admin',
      sandboxRoleLocked: false,
    }),
    'patient',
  );

  assert.equal(
    resolveEffectiveRole({
      isAuthenticated: true,
      email: ADMIN_BOOTSTRAP_EMAIL,
      emailVerified: true,
      firestoreRole: 'patient',
      sandboxRole: 'patient',
      sandboxRoleLocked: true,
    }),
    'admin',
  );

  assert.equal(
    resolveEffectiveRole({
      isAuthenticated: true,
      email: 'clinician@phc.gov.in',
      emailVerified: true,
      firestoreRole: 'doctor',
      sandboxRole: 'patient',
      sandboxRoleLocked: false,
    }),
    'doctor',
  );
});

test('canAccessRoute restricts Admin, Doctor, and Register routes by role', () => {
  assert.equal(canAccessRoute('patient', 'admin'), false);
  assert.equal(canAccessRoute('patient', 'doctor'), false);
  assert.equal(canAccessRoute('patient', 'register'), false);
  assert.equal(canAccessRoute('patient', 'patient'), true);
  assert.equal(canAccessRoute('patient', 'consent'), true);

  assert.equal(canAccessRoute('doctor', 'admin'), false);
  assert.equal(canAccessRoute('doctor', 'doctor'), true);
  assert.equal(canAccessRoute('doctor', 'register'), true);

  assert.equal(canAccessRoute('admin', 'admin'), true);
  assert.equal(canAccessRoute('admin', 'doctor'), true);
});

test('canAccessPatientRecord isolates patient principals to assignedHealthId', () => {
  assert.equal(
    canAccessPatientRecord({
      role: 'patient',
      assignedPatientId: 'MHIS-BR-MH-1042',
      targetHealthId: 'MHIS-BR-MH-1042',
    }),
    true,
  );
  assert.equal(
    canAccessPatientRecord({
      role: 'patient',
      assignedPatientId: 'MHIS-BR-MH-1042',
      targetHealthId: 'MHIS-RJ-MH-6720',
    }),
    false,
  );
  assert.equal(
    canAccessPatientRecord({
      role: 'doctor',
      assignedPatientId: 'MHIS-BR-MH-1042',
      targetHealthId: 'MHIS-RJ-MH-6720',
    }),
    true,
  );
});
