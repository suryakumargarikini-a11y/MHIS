import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  browserPopupRedirectResolver,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  INITIAL_AUDIT_LOGS,
  INITIAL_CONSENTS,
  INITIAL_LINKAGE_CANDIDATES,
  INITIAL_PATIENTS,
} from '../data/syntheticPatients.ts';
import type {
  AccessAuditEntry,
  AppRoute,
  ClinicalEncounter,
  ConsentPreferences,
  LinkageCandidate,
  MigrantPatient,
  UserRole,
} from '../types/health.ts';
import { assessContinuityRisk } from '../lib/continuityRisk.ts';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
  testFirestoreConnection,
} from '../lib/firebase.ts';
import {
  canAccessPatientRecord,
  canAccessRoute,
  isBootstrapAdminEmail,
  resolveEffectiveRole,
} from '../lib/rbac.ts';

// Non-PHI UI preference key only (no patient names, healthIds, diagnoses, or clinical data)
const UI_PREF_STORAGE_KEY = 'mhis_ui_prefs_v1';
const VALID_ROUTES: AppRoute[] = [
  'overview',
  'admin',
  'doctor',
  'patient',
  'register',
  'consent',
  'audit',
  'privacy',
  'terms',
];

function parseRouteFromHash(): AppRoute {
  const hash = window.location.hash.replace(/^#/, '').toLowerCase() as AppRoute;
  return VALID_ROUTES.includes(hash) ? hash : 'overview';
}

function loadNonPhiUiPreferences(): { sandboxRole: UserRole } {
  try {
    const raw = window.localStorage.getItem(UI_PREF_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { sandboxRole?: string };
      if (parsed.sandboxRole === 'admin' || parsed.sandboxRole === 'doctor' || parsed.sandboxRole === 'patient') {
        return { sandboxRole: parsed.sandboxRole };
      }
    }
  } catch {
    // Ignore storage read errors
  }
  return { sandboxRole: 'doctor' };
}

export interface AccessDeniedState {
  route: AppRoute;
  actualRole: UserRole;
  reason: string;
}

interface HealthSystemContextValue {
  role: UserRole;
  effectiveRole: UserRole;
  sandboxRoleLocked: boolean;
  togglePatientRbacLock: () => void;
  setRole: (role: UserRole) => void;
  route: AppRoute;
  navigate: (route: AppRoute) => void;
  accessDenied: AccessDeniedState | null;
  clearAccessDenied: () => void;
  patients: MigrantPatient[];
  assignedPatientId: string;
  selectedPatientId: string;
  setSelectedPatientId: (id: string) => void;
  selectedPatient: MigrantPatient;
  linkageCandidates: LinkageCandidate[];
  consents: Record<string, ConsentPreferences>;
  auditLogs: AccessAuditEntry[];
  revokedPassIds: string[];
  getAuthHeaders: () => Promise<Record<string, string>>;
  revokeQrPass: (passId: string, healthId: string) => Promise<void>;
  user: User | null;
  authReady: boolean;
  authError: string;
  clearAuthError: () => void;
  syncError: string;
  clearSyncError: () => void;
  firestoreConnected: boolean;
  isSimulatingLoad: boolean;
  triggerLoadingPreview: () => void;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  registerPatient: (patient: MigrantPatient) => Promise<void>;
  linkExternalRecordToPatient: (
    healthId: string,
    externalRef: string,
    facilityName: string,
    state: string,
  ) => void;
  resolveLinkageCandidate: (candidateId: string, decision: 'MERGED' | 'REJECTED') => Promise<void>;
  addClinicalEncounter: (
    healthId: string,
    encounter: Omit<ClinicalEncounter, 'encounterId' | 'patientHealthId'>,
  ) => Promise<void>;
  recordMigrationMove: (
    healthId: string,
    newState: string,
    newDistrict: string,
    sector: string,
  ) => Promise<void>;
  updateConsent: (
    healthId: string,
    patch: Partial<
      Pick<ConsentPreferences, 'interStateSharing' | 'emergencyQrAccess' | 'anonymizedSurveillance'>
    >,
  ) => Promise<void>;
  logAccessEvent: (entry: Omit<AccessAuditEntry, 'logId' | 'timestamp'>) => Promise<void>;
  resetDemoDataset: () => void;
}

const HealthSystemContext = createContext<HealthSystemContextValue | null>(null);

export const HealthSystemProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Clinical records are kept strictly in React memory (or fetched from authenticated server APIs), never in localStorage.
  const [patients, setPatients] = useState<MigrantPatient[]>(INITIAL_PATIENTS);
  const [linkageCandidates, setLinkageCandidates] = useState<LinkageCandidate[]>(
    INITIAL_LINKAGE_CANDIDATES,
  );
  const [consents, setConsents] = useState<Record<string, ConsentPreferences>>(INITIAL_CONSENTS);
  const [auditLogs, setAuditLogs] = useState<AccessAuditEntry[]>(INITIAL_AUDIT_LOGS);
  const [revokedPassIds, setRevokedPassIds] = useState<string[]>([]);

  const [sandboxRole, setSandboxRole] = useState<UserRole>(
    () => loadNonPhiUiPreferences().sandboxRole,
  );
  const [sandboxRoleLocked, setSandboxRoleLocked] = useState(false);
  const [firestoreUserRole, setFirestoreUserRole] = useState<UserRole | null>(null);

  const [route, setRoute] = useState<AppRoute>(() => parseRouteFromHash());
  const [accessDenied, setAccessDenied] = useState<AccessDeniedState | null>(null);

  const assignedPatientId = patients[0]?.healthId ?? 'MHIS-BR-MH-1042';
  const [selectedPatientId, setSelectedPatientIdState] = useState<string>(assignedPatientId);

  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [firestoreConnected, setFirestoreConnected] = useState(false);
  const [isSimulatingLoad, setIsSimulatingLoad] = useState(false);

  const effectiveRole = useMemo(
    () =>
      resolveEffectiveRole({
        isAuthenticated: Boolean(user),
        email: user?.email,
        emailVerified: user?.emailVerified,
        firestoreRole: firestoreUserRole,
        sandboxRole,
        sandboxRoleLocked,
      }),
    [user, firestoreUserRole, sandboxRole, sandboxRoleLocked],
  );

  const isRbacEnforced = Boolean(user) || sandboxRoleLocked;

  // Persist ONLY non-PHI UI preference to localStorage
  useEffect(() => {
    try {
      window.localStorage.setItem(UI_PREF_STORAGE_KEY, JSON.stringify({ sandboxRole }));
    } catch {
      // Ignore storage quota errors
    }
  }, [sandboxRole]);

  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (!user) {
      return { 'Content-Type': 'application/json' };
    }
    const token = await user.getIdToken();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }, [user]);

  const resolveClientFirestoreRole = useCallback(async (firebaseUser: User): Promise<UserRole> => {
    if (isBootstrapAdminEmail(firebaseUser.email, firebaseUser.emailVerified)) {
      return 'admin';
    }

    if (firebaseUser.emailVerified) {
      try {
        const adminSnap = await getDoc(doc(db, 'admins', firebaseUser.uid));
        if (adminSnap.exists()) {
          return 'admin';
        }
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.GET, `admins/${firebaseUser.uid}`);
        } catch {
          // Continue to users/{uid} lookup if admins check fails
        }
      }
    }

    const userRef = doc(db, 'users', firebaseUser.uid);
    try {
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const data = snap.data() as { role?: string };
        if (data.role === 'admin' && firebaseUser.emailVerified) return 'admin';
        return data.role === 'doctor' ? 'doctor' : 'patient';
      }

      if (firebaseUser.emailVerified) {
        try {
          // Least-privilege self-registration: clients may only create 'patient' accounts
          await setDoc(userRef, {
            uid: firebaseUser.uid,
            role: 'patient',
            displayName: (firebaseUser.displayName || 'Registered Migrant User').slice(0, 120),
            createdAt: serverTimestamp(),
          });
        } catch (createErr) {
          handleFirestoreError(createErr, OperationType.CREATE, `users/${firebaseUser.uid}`);
        }
      }
      return 'patient';
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}`);
      } catch (wrapped) {
        setSyncError(
          wrapped instanceof Error
            ? `Firestore role check note: ${wrapped.message}`
            : 'Unable to verify Firestore role profile; defaulted to least-privilege patient role.',
        );
      }
      return 'patient';
    }
  }, []);

  const syncFromAuthenticatedBackend = useCallback(async (firebaseUser: User) => {
    try {
      const idToken = await firebaseUser.getIdToken();
      const headers = { Authorization: `Bearer ${idToken}` };

      const [sessionRes, patRes, auditRes] = await Promise.all([
        fetch('/api/auth/session', { headers }),
        fetch('/api/patients', { headers }),
        fetch('/api/audit', { headers }),
      ]);

      if (sessionRes.status === 401 || patRes.status === 401) {
        setAuthError(
          'Backend rejected the Firebase ID token (HTTP 401). Please sign in again.',
        );
        return;
      }

      if (sessionRes.ok) {
        const sessionBody = (await sessionRes.json()) as { role?: UserRole };
        if (
          sessionBody.role === 'admin' ||
          sessionBody.role === 'doctor' ||
          sessionBody.role === 'patient'
        ) {
          setFirestoreUserRole(sessionBody.role);
        }
      }

      if (patRes.ok) {
        const patBody = (await patRes.json()) as {
          patients?: MigrantPatient[];
          consents?: Record<string, ConsentPreferences>;
        };
        if (Array.isArray(patBody.patients) && patBody.patients.length > 0) {
          setPatients(patBody.patients);
          setSelectedPatientIdState(patBody.patients[0].healthId);
        }
        if (patBody.consents && Object.keys(patBody.consents).length > 0) {
          setConsents(patBody.consents);
        }
      }

      if (auditRes.ok) {
        const auditBody = (await auditRes.json()) as { auditLogs?: AccessAuditEntry[] };
        if (Array.isArray(auditBody.auditLogs) && auditBody.auditLogs.length > 0) {
          setAuditLogs(auditBody.auditLogs);
        }
      }
    } catch {
      // Keep UI operational if server Admin SDK credentials are unavailable in sandbox preview
    }
  }, []);

  useEffect(() => {
    testFirestoreConnection().then(setFirestoreConnected);
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        const clientRole = await resolveClientFirestoreRole(firebaseUser);
        setFirestoreUserRole(clientRole);
        await syncFromAuthenticatedBackend(firebaseUser);
      } else {
        setFirestoreUserRole(null);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, [resolveClientFirestoreRole, syncFromAuthenticatedBackend]);

  // Re-evaluate active route if RBAC lock or authenticated role changes
  useEffect(() => {
    if (isRbacEnforced && !canAccessRoute(effectiveRole, route)) {
      setAccessDenied({
        route,
        actualRole: effectiveRole,
        reason: `Role "${effectiveRole}" does not have authorization to access the "${route}" workspace.`,
      });
    } else {
      setAccessDenied(null);
    }
  }, [isRbacEnforced, effectiveRole, route]);

  // Listen to browser hash changes so direct URL navigation is always RBAC-checked
  useEffect(() => {
    const onHashChange = () => {
      const next = parseRouteFromHash();
      if (isRbacEnforced && !canAccessRoute(effectiveRole, next)) {
        setAccessDenied({
          route: next,
          actualRole: effectiveRole,
          reason: `Unauthorized direct route navigation to #${next} blocked for role "${effectiveRole}".`,
        });
      } else {
        setAccessDenied(null);
      }
      setRoute(next);
      window.scrollTo({ top: 0, behavior: 'auto' });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [isRbacEnforced, effectiveRole]);

  const setSelectedPatientId = (targetId: string) => {
    if (
      isRbacEnforced &&
      !canAccessPatientRecord({
        role: effectiveRole,
        assignedPatientId,
        targetHealthId: targetId,
      })
    ) {
      setSyncError(
        `Access denied: "${effectiveRole}" principal cannot view another patient's record (${targetId}).`,
      );
      void logAccessEvent({
        healthId: targetId,
        patientName: 'Restricted Record',
        actorRole: effectiveRole,
        actorName: user?.displayName || `${effectiveRole.toUpperCase()} Session`,
        facilityState: 'RBAC Guard',
        action: 'Cross-Patient Access Blocked',
        scope: 'Patient Record Isolation',
        purpose: `Blocked unauthorized read attempt for ${targetId}`,
      });
      return;
    }
    setSelectedPatientIdState(targetId);
  };

  const selectedPatient = useMemo(() => {
    if (isRbacEnforced && effectiveRole === 'patient') {
      return patients.find((p) => p.healthId === assignedPatientId) ?? patients[0];
    }
    return patients.find((p) => p.healthId === selectedPatientId) ?? patients[0];
  }, [patients, selectedPatientId, isRbacEnforced, effectiveRole, assignedPatientId]);

  const setRole = (nextRole: UserRole) => {
    if (user || sandboxRoleLocked) {
      setSyncError(
        'Role switching is disabled while an authenticated session or RBAC lock is active.',
      );
      return;
    }
    setSandboxRole(nextRole);
    setRoute(nextRole);
    window.location.hash = nextRole;
  };

  const togglePatientRbacLock = () => {
    setSandboxRoleLocked((prev) => {
      const nextLocked = !prev;
      if (nextLocked) {
        setSandboxRole('patient');
        setSelectedPatientIdState(assignedPatientId);
      } else {
        setAccessDenied(null);
      }
      return nextLocked;
    });
  };

  const navigate = (nextRoute: AppRoute) => {
    if (isRbacEnforced) {
      if (!canAccessRoute(effectiveRole, nextRoute)) {
        setAccessDenied({
          route: nextRoute,
          actualRole: effectiveRole,
          reason: `Unauthorized route navigation to "${nextRoute}" blocked for "${effectiveRole}" principal.`,
        });
        void logAccessEvent({
          healthId: assignedPatientId,
          patientName: 'System Security Policy',
          actorRole: effectiveRole,
          actorName: user?.displayName || `${effectiveRole.toUpperCase()} Principal`,
          facilityState: 'RBAC Gate',
          action: 'Unauthorized Route Access Blocked',
          scope: `Route #${nextRoute}`,
          purpose: `Role ${effectiveRole} attempted unauthorized navigation to #${nextRoute}`,
        });
        setRoute(nextRoute);
        window.location.hash = nextRoute;
        return;
      }
      setAccessDenied(null);
    } else if (nextRoute === 'admin' || nextRoute === 'doctor' || nextRoute === 'patient') {
      setSandboxRole(nextRoute);
      setAccessDenied(null);
    } else {
      setAccessDenied(null);
    }

    setRoute(nextRoute);
    window.location.hash = nextRoute;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const triggerLoadingPreview = () => {
    setIsSimulatingLoad(true);
    window.setTimeout(() => setIsSimulatingLoad(false), 650);
  };

  const signInWithGoogle = async () => {
    setAuthError('');
    try {
      // onAuthStateChanged handles least-privilege user profile creation and backend session sync
      await signInWithPopup(auth, googleProvider, browserPopupRedirectResolver);
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code)
          : '';
      const msg = err instanceof Error ? err.message : 'Google sign-in failed.';

      if (code === 'auth/unauthorized-domain' || msg.includes('unauthorized-domain')) {
        setAuthError(
          `Firebase Auth Error: Domain "${window.location.hostname}" is not authorized. Please add "${window.location.hostname}" to Firebase Console > Authentication > Settings > Authorized domains.`,
        );
      } else if (code === 'auth/popup-closed-by-user') {
        setAuthError(
          `Sign-in popup closed automatically. In Firebase Console (project mhis-40ff1), add "${window.location.hostname}" under Authentication > Settings > Authorized domains.`,
        );
      } else {
        setAuthError(`Google sign-in could not complete: ${msg}`);
      }
    }
  };

  const signOutUser = async () => {
    setAuthError('');
    try {
      await signOut(auth);
      setFirestoreUserRole(null);
      setAccessDenied(null);
      setSyncError('');
      // Clear any authenticated/user-entered patient state from browser memory on logout
      setPatients(INITIAL_PATIENTS);
      setLinkageCandidates(INITIAL_LINKAGE_CANDIDATES);
      setConsents(INITIAL_CONSENTS);
      setAuditLogs(INITIAL_AUDIT_LOGS);
      setRevokedPassIds([]);
      setSelectedPatientIdState(INITIAL_PATIENTS[0].healthId);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign-out failed.');
    }
  };

  const logAccessEvent = async (entry: Omit<AccessAuditEntry, 'logId' | 'timestamp'>) => {
    const logId = `AUD-${Date.now().toString(36).toUpperCase()}`;
    const fullEntry: AccessAuditEntry = {
      ...entry,
      logId,
      timestamp: new Date().toISOString(),
    };
    setAuditLogs((prev) => [fullEntry, ...prev]);

    if (user) {
      try {
        await setDoc(doc(db, 'auditLogs', logId), {
          logId,
          healthId: entry.healthId,
          ownerUid: user.uid,
          actorRole: entry.actorRole,
          action: entry.action.slice(0, 120),
          purpose: entry.purpose.slice(0, 240),
          createdAt: serverTimestamp(),
        });
      } catch (error) {
        try {
          handleFirestoreError(error, OperationType.CREATE, `auditLogs/${logId}`);
        } catch (wrapped) {
          setSyncError(
            wrapped instanceof Error ? wrapped.message : 'Audit log cloud sync failed.',
          );
        }
      }
    }
  };

  const revokeQrPass = async (passId: string, healthId: string) => {
    setRevokedPassIds((prev) => (prev.includes(passId) ? prev : [...prev, passId]));
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/qr/revoke', {
        method: 'POST',
        headers,
        body: JSON.stringify({ passId, healthId }),
      });
      if (!res.ok) {
        const errBody = (await res.json()) as { error?: string };
        setSyncError(errBody.error || `Server QR revocation returned HTTP ${res.status}.`);
      }
    } catch {
      setSyncError('Unable to reach server QR revocation endpoint.');
    }
    const target = patients.find((p) => p.healthId === healthId);
    await logAccessEvent({
      healthId,
      patientName: target?.fullName || healthId,
      actorRole: effectiveRole,
      actorName: user?.displayName || target?.fullName || 'Patient',
      facilityState: target?.currentState || 'National Portal',
      action: 'QR Health Pass Revoked',
      scope: `Pass ${passId}`,
      purpose: 'Patient-initiated pass revocation',
    });
  };

  const registerPatient = async (patient: MigrantPatient) => {
    if (isRbacEnforced && effectiveRole === 'patient') {
      setSyncError('Patients cannot register third-party profiles while RBAC lock is enabled.');
      return;
    }

    setPatients((prev) => [patient, ...prev]);
    setSelectedPatientIdState(patient.healthId);

    const defaultConsent: ConsentPreferences = {
      healthId: patient.healthId,
      interStateSharing: true,
      emergencyQrAccess: true,
      anonymizedSurveillance: true,
      updatedAt: new Date().toISOString(),
      updatedByRole: effectiveRole,
    };
    setConsents((prev) => ({ ...prev, [patient.healthId]: defaultConsent }));

    const risk = assessContinuityRisk(patient);
    if (user) {
      try {
        const headers = await getAuthHeaders();
        const apiRes = await fetch('/api/patients', {
          method: 'POST',
          headers,
          body: JSON.stringify({ patient }),
        });
        if (!apiRes.ok) {
          // Fallback to direct client Firestore document writes matching firestore.rules schemas
          try {
            await setDoc(doc(db, 'patients', patient.healthId), {
              healthId: patient.healthId,
              fullName: patient.fullName.slice(0, 120),
              age: Math.round(patient.age),
              gender: patient.gender,
              originState: patient.originState.slice(0, 64),
              currentState: patient.currentState.slice(0, 64),
              primaryLanguage: patient.primaryLanguage.slice(0, 40),
              bloodGroup: patient.bloodGroup.slice(0, 8),
              continuityRiskScore: risk.score,
              continuityRiskTier: risk.tier,
              recordLinkageStatus: patient.recordLinkageStatus,
              ownerUid: user.uid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } catch (patErr) {
            handleFirestoreError(patErr, OperationType.CREATE, `patients/${patient.healthId}`);
          }
          try {
            await setDoc(doc(db, 'consents', patient.healthId), {
              healthId: patient.healthId,
              ownerUid: user.uid,
              interStateSharing: defaultConsent.interStateSharing,
              emergencyQrAccess: defaultConsent.emergencyQrAccess,
              anonymizedSurveillance: defaultConsent.anonymizedSurveillance,
              updatedAt: serverTimestamp(),
            });
          } catch (consErr) {
            handleFirestoreError(consErr, OperationType.CREATE, `consents/${patient.healthId}`);
          }
        }
      } catch (wrapped) {
        setSyncError(
          wrapped instanceof Error ? wrapped.message : 'Patient registration cloud sync failed.',
        );
      }
    }

    await logAccessEvent({
      healthId: patient.healthId,
      patientName: patient.fullName,
      actorRole: effectiveRole,
      actorName: user?.displayName || `${effectiveRole.toUpperCase()} Registrar (Demo)`,
      facilityState: patient.currentState,
      action: 'Migrant Health ID Registered',
      scope: 'Unified Health Registry',
      purpose: 'New portable health registration & QR Health Pass issuance',
    });
  };

  const linkExternalRecordToPatient = (
    healthId: string,
    externalRef: string,
    facilityName: string,
    state: string,
  ) => {
    setPatients((prev) =>
      prev.map((p) => {
        if (p.healthId !== healthId) return p;
        const nextRefs = p.externalRefIds.includes(externalRef)
          ? p.externalRefIds
          : [...p.externalRefIds, externalRef];
        return {
          ...p,
          externalRefIds: nextRefs,
          recordLinkageStatus: 'LINKED',
          currentState: state,
          updatedAt: new Date().toISOString(),
        };
      }),
    );
    const target = patients.find((p) => p.healthId === healthId);
    void logAccessEvent({
      healthId,
      patientName: target?.fullName || healthId,
      actorRole: effectiveRole,
      actorName: user?.displayName || 'Entity Resolution Steward',
      facilityState: state,
      action: 'Cross-State Record Linked',
      scope: 'Inter-State Record Linkage',
      purpose: `Linked external ref ${externalRef} from ${facilityName}`,
    });
  };

  const resolveLinkageCandidate = async (candidateId: string, decision: 'MERGED' | 'REJECTED') => {
    const candidate = linkageCandidates.find((c) => c.candidateId === candidateId);
    if (!candidate) return;

    setLinkageCandidates((prev) =>
      prev.map((c) => (c.candidateId === candidateId ? { ...c, status: decision } : c)),
    );

    if (decision === 'MERGED') {
      setPatients((prev) =>
        prev.map((p) => {
          if (p.healthId !== candidate.matchedHealthId) return p;
          const refs = p.externalRefIds.includes(candidate.incomingRecordRef)
            ? p.externalRefIds
            : [...p.externalRefIds, candidate.incomingRecordRef];
          return {
            ...p,
            externalRefIds: refs,
            recordLinkageStatus: 'LINKED',
            updatedAt: new Date().toISOString(),
          };
        }),
      );
    }

    if (user) {
      try {
        const headers = await getAuthHeaders();
        await fetch(`/api/admin/linkage/${candidateId}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ decision }),
        });
      } catch {
        // Non-fatal sync note handled via audit log
      }
    }

    await logAccessEvent({
      healthId: candidate.matchedHealthId,
      patientName: candidate.matchedPatientName,
      actorRole: effectiveRole,
      actorName: user?.displayName || 'Linkage Adjudicator',
      facilityState: candidate.incomingState,
      action:
        decision === 'MERGED' ? 'Linkage Candidate Merged' : 'Linkage Candidate Marked Distinct',
      scope: 'Entity Resolution Queue',
      purpose: `${candidate.candidateId} (${candidate.incomingRecordRef} @ ${candidate.incomingFacility})`,
    });
  };

  const addClinicalEncounter = async (
    healthId: string,
    encounterInput: Omit<ClinicalEncounter, 'encounterId' | 'patientHealthId'>,
  ) => {
    const encounterId = `ENC-${Date.now().toString(36).toUpperCase()}`;
    const newEncounter: ClinicalEncounter = {
      ...encounterInput,
      encounterId,
      patientHealthId: healthId,
    };

    setPatients((prev) =>
      prev.map((p) => {
        if (p.healthId !== healthId) return p;
        return {
          ...p,
          currentState: encounterInput.state,
          currentDistrict: encounterInput.district,
          daysSinceLastVisit: 0,
          medicationGapDays: 0,
          encounters: [newEncounter, ...p.encounters],
          updatedAt: new Date().toISOString(),
        };
      }),
    );

    if (user) {
      try {
        const headers = await getAuthHeaders();
        const apiRes = await fetch(`/api/patients/${healthId}/encounters`, {
          method: 'POST',
          headers,
          body: JSON.stringify(encounterInput),
        });
        if (!apiRes.ok && (effectiveRole === 'admin' || effectiveRole === 'doctor')) {
          try {
            await setDoc(doc(db, 'patients', healthId, 'encounters', encounterId), {
              encounterId,
              patientHealthId: healthId,
              facilityName: encounterInput.facilityName.trim().slice(0, 160),
              state: encounterInput.state.slice(0, 64),
              diagnosis: encounterInput.diagnosis.trim().slice(0, 240),
              ownerUid: user.uid,
              createdAt: serverTimestamp(),
            });
          } catch (encErr) {
            handleFirestoreError(
              encErr,
              OperationType.CREATE,
              `patients/${healthId}/encounters/${encounterId}`,
            );
          }
        }
      } catch (wrapped) {
        setSyncError(
          wrapped instanceof Error ? wrapped.message : 'Encounter cloud sync note.',
        );
      }
    }

    const target = patients.find((p) => p.healthId === healthId);
    // Log metadata only in audit ledger; avoid storing raw free-text clinical diagnosis in purpose
    await logAccessEvent({
      healthId,
      patientName: target?.fullName || healthId,
      actorRole: effectiveRole,
      actorName: encounterInput.clinicianName,
      facilityState: encounterInput.state,
      action: 'Clinical Encounter Logged',
      scope: 'Longitudinal Medical Timeline',
      purpose: `${encounterInput.encounterType} documented (${encounterInput.icdCode || 'coded'})`,
    });
  };

  const recordMigrationMove = async (
    healthId: string,
    newState: string,
    newDistrict: string,
    sector: string,
  ) => {
    if (
      isRbacEnforced &&
      !canAccessPatientRecord({
        role: effectiveRole,
        assignedPatientId,
        targetHealthId: healthId,
      })
    ) {
      setSyncError(`Access denied: cannot update migration trajectory for ${healthId}.`);
      return;
    }

    const arrivalDate = new Date().toISOString().slice(0, 10);
    setPatients((prev) =>
      prev.map((p) => {
        if (p.healthId !== healthId) return p;
        return {
          ...p,
          currentState: newState,
          currentDistrict: newDistrict,
          occupationSector: sector || p.occupationSector,
          migrationHistory: [
            ...p.migrationHistory,
            {
              state: newState,
              district: newDistrict,
              arrivalDate,
              sector: sector || p.occupationSector,
            },
          ],
          updatedAt: new Date().toISOString(),
        };
      }),
    );

    if (user) {
      try {
        const headers = await getAuthHeaders();
        await fetch(`/api/patients/${healthId}/migration`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ state: newState, district: newDistrict, sector }),
        });
      } catch {
        // Non-fatal
      }
    }

    const target = patients.find((p) => p.healthId === healthId);
    await logAccessEvent({
      healthId,
      patientName: target?.fullName || healthId,
      actorRole: effectiveRole,
      actorName: target?.fullName || 'Patient',
      facilityState: newState,
      action: 'Interstate Migration Trajectory Updated',
      scope: 'Migration Mobility Record',
      purpose: `Location transition to ${newDistrict}, ${newState}`,
    });
  };

  const updateConsent = async (
    healthId: string,
    patch: Partial<
      Pick<ConsentPreferences, 'interStateSharing' | 'emergencyQrAccess' | 'anonymizedSurveillance'>
    >,
  ) => {
    if (
      isRbacEnforced &&
      !canAccessPatientRecord({
        role: effectiveRole,
        assignedPatientId,
        targetHealthId: healthId,
      })
    ) {
      setSyncError(`Access denied: cannot modify consent preferences for ${healthId}.`);
      return;
    }

    const existing = consents[healthId] ?? {
      healthId,
      interStateSharing: true,
      emergencyQrAccess: true,
      anonymizedSurveillance: true,
      updatedAt: new Date().toISOString(),
      updatedByRole: effectiveRole,
    };

    const next: ConsentPreferences = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
      updatedByRole: effectiveRole,
    };

    setConsents((prev) => ({ ...prev, [healthId]: next }));

    if (user) {
      try {
        const headers = await getAuthHeaders();
        const apiRes = await fetch(`/api/consents/${healthId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(patch),
        });
        if (!apiRes.ok) {
          const consentRef = doc(db, 'consents', healthId);
          let existingSnapExists = false;
          try {
            const snap = await getDoc(consentRef);
            existingSnapExists = snap.exists();
          } catch (readErr) {
            handleFirestoreError(readErr, OperationType.GET, `consents/${healthId}`);
          }
          try {
            if (existingSnapExists) {
              await updateDoc(consentRef, {
                interStateSharing: next.interStateSharing,
                emergencyQrAccess: next.emergencyQrAccess,
                anonymizedSurveillance: next.anonymizedSurveillance,
                updatedAt: serverTimestamp(),
              });
            } else {
              await setDoc(consentRef, {
                healthId,
                ownerUid: user.uid,
                interStateSharing: next.interStateSharing,
                emergencyQrAccess: next.emergencyQrAccess,
                anonymizedSurveillance: next.anonymizedSurveillance,
                updatedAt: serverTimestamp(),
              });
            }
          } catch (writeErr) {
            handleFirestoreError(writeErr, OperationType.WRITE, `consents/${healthId}`);
          }
        }
      } catch (wrapped) {
        setSyncError(wrapped instanceof Error ? wrapped.message : 'Consent cloud sync failed.');
      }
    }

    const target = patients.find((p) => p.healthId === healthId);
    const changedKeys = Object.entries(patch)
      .map(([k, v]) => `${k}=${v ? 'Granted' : 'Revoked'}`)
      .join(', ');

    await logAccessEvent({
      healthId,
      patientName: target?.fullName || healthId,
      actorRole: effectiveRole,
      actorName: user?.displayName || target?.fullName || 'Patient Steward',
      facilityState: target?.currentState || 'National Portal',
      action: 'Consent Preference Modified',
      scope: changedKeys,
      purpose: 'Patient-controlled data governance update',
    });
  };

  const resetDemoDataset = () => {
    setPatients(INITIAL_PATIENTS);
    setLinkageCandidates(INITIAL_LINKAGE_CANDIDATES);
    setConsents(INITIAL_CONSENTS);
    setAuditLogs(INITIAL_AUDIT_LOGS);
    setRevokedPassIds([]);
    setSelectedPatientIdState(INITIAL_PATIENTS[0].healthId);
  };

  return (
    <HealthSystemContext.Provider
      value={{
        role: effectiveRole,
        effectiveRole,
        sandboxRoleLocked,
        togglePatientRbacLock,
        setRole,
        route,
        navigate,
        accessDenied,
        clearAccessDenied: () => setAccessDenied(null),
        patients,
        assignedPatientId,
        selectedPatientId,
        setSelectedPatientId,
        selectedPatient,
        linkageCandidates,
        consents,
        auditLogs,
        revokedPassIds,
        getAuthHeaders,
        revokeQrPass,
        user,
        authReady,
        authError,
        clearAuthError: () => setAuthError(''),
        syncError,
        clearSyncError: () => setSyncError(''),
        firestoreConnected,
        isSimulatingLoad,
        triggerLoadingPreview,
        signInWithGoogle,
        signOutUser,
        registerPatient,
        linkExternalRecordToPatient,
        resolveLinkageCandidate,
        addClinicalEncounter,
        recordMigrationMove,
        updateConsent,
        logAccessEvent,
        resetDemoDataset,
      }}
    >
      {children}
    </HealthSystemContext.Provider>
  );
};

export function useHealthSystem(): HealthSystemContextValue {
  const ctx = useContext(HealthSystemContext);
  if (!ctx) throw new Error('useHealthSystem must be used inside HealthSystemProvider');
  return ctx;
}
