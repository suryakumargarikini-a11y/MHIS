import fs from 'node:fs';
import path from 'node:path';
import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { isBootstrapAdminEmail } from './rbac.ts';
import type {
  AccessAuditEntry,
  ClinicalEncounter,
  ConsentPreferences,
  LinkageCandidate,
  MigrantPatient,
  UserRole,
} from '../types/health.ts';

export type AuthErrorCode =
  | 'MISSING_TOKEN'
  | 'INVALID_TOKEN'
  | 'EXPIRED_TOKEN'
  | 'REVOKED_TOKEN'
  | 'AUTH_UNAVAILABLE';

export class AuthVerificationError extends Error {
  readonly code: AuthErrorCode;
  readonly httpStatus: 401 | 503;

  constructor(code: AuthErrorCode, message: string, httpStatus: 401 | 503 = 401) {
    super(message);
    this.name = 'AuthVerificationError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export class DataStoreUnavailableError extends Error {
  readonly code = 'DATA_STORE_UNAVAILABLE';
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'DataStoreUnavailableError';
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

export interface VerifiedTokenClaims {
  uid: string;
  email?: string;
  emailVerified: boolean;
  displayName?: string;
}

export interface AuthenticatedPrincipal extends VerifiedTokenClaims {
  role: UserRole;
}

export interface AuthTokenVerifier {
  verifyBearerToken(idToken: string): Promise<VerifiedTokenClaims>;
}

export interface StoredPatientRecord {
  patient: MigrantPatient;
  ownerUid: string;
}

export interface AuthoritativeDataStore {
  getUserRole(claims: VerifiedTokenClaims): Promise<UserRole>;
  getPatientWithOwner(healthId: string): Promise<StoredPatientRecord | null>;
  listPatientsForActor(actor: AuthenticatedPrincipal): Promise<StoredPatientRecord[]>;
  createOrUpdatePatient(
    patient: MigrantPatient,
    ownerUid: string,
    defaultConsent?: Partial<ConsentPreferences>,
  ): Promise<StoredPatientRecord>;
  appendEncounter(
    healthId: string,
    encounter: ClinicalEncounter,
    actorUid: string,
  ): Promise<StoredPatientRecord | null>;
  recordMigrationMove(
    healthId: string,
    move: { state: string; district: string; sector: string; arrivalDate: string },
  ): Promise<StoredPatientRecord | null>;
  getConsent(healthId: string): Promise<ConsentPreferences | null>;
  updateConsent(
    healthId: string,
    ownerUid: string,
    patch: Partial<
      Pick<ConsentPreferences, 'interStateSharing' | 'emergencyQrAccess' | 'anonymizedSurveillance'>
    >,
    actorRole: UserRole,
  ): Promise<ConsentPreferences>;
  appendAuditLog(entry: AccessAuditEntry, ownerUid: string): Promise<void>;
  listAuditLogsForActor(actor: AuthenticatedPrincipal): Promise<AccessAuditEntry[]>;
  listLinkageCandidates(): Promise<LinkageCandidate[]>;
  resolveLinkageCandidate(
    candidateId: string,
    decision: 'MERGED' | 'REJECTED',
  ): Promise<LinkageCandidate | null>;
}

interface FirebaseAppletConfigFile {
  projectId: string;
  firestoreDatabaseId?: string;
}

const DEFAULT_PROJECT_ID = 'mhis-40ff1';
const DEFAULT_FIRESTORE_DATABASE_ID = 'ai-studio-85830e53-0349-481d-ae27-ffdfdecbe5c5';

let cachedAdminApp: App | null = null;
let cachedConfig: FirebaseAppletConfigFile | null = null;

export function parseFirebaseServiceAccountFromEnv(
  rawValue = process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
): ServiceAccount | null {
  const trimmed = rawValue?.trim();
  if (!trimmed) return null;

  let jsonText = trimmed;
  if (!trimmed.startsWith('{')) {
    try {
      jsonText = Buffer.from(trimmed, 'base64').toString('utf8');
    } catch {
      throw new AuthVerificationError(
        'AUTH_UNAVAILABLE',
        'FIREBASE_SERVICE_ACCOUNT_JSON is neither valid JSON nor valid base64.',
        503,
      );
    }
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    throw new AuthVerificationError(
      'AUTH_UNAVAILABLE',
      'FIREBASE_SERVICE_ACCOUNT_JSON could not be parsed as JSON.',
      503,
    );
  }

  const projectId =
    typeof parsed.project_id === 'string'
      ? parsed.project_id
      : typeof parsed.projectId === 'string'
        ? parsed.projectId
        : undefined;
  const clientEmail =
    typeof parsed.client_email === 'string'
      ? parsed.client_email
      : typeof parsed.clientEmail === 'string'
        ? parsed.clientEmail
        : undefined;
  const rawPrivateKey =
    typeof parsed.private_key === 'string'
      ? parsed.private_key
      : typeof parsed.privateKey === 'string'
        ? parsed.privateKey
        : undefined;

  if (!projectId || !clientEmail || !rawPrivateKey) {
    throw new AuthVerificationError(
      'AUTH_UNAVAILABLE',
      'FIREBASE_SERVICE_ACCOUNT_JSON is missing required fields (project_id, client_email, private_key).',
      503,
    );
  }

  return {
    projectId,
    clientEmail,
    privateKey: rawPrivateKey.replace(/\\n/g, '\n'),
  };
}

export function loadFirebaseAppletConfig(): FirebaseAppletConfigFile {
  if (cachedConfig) return cachedConfig;

  let fileConfig: Partial<FirebaseAppletConfigFile> = {};
  const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(cfgPath)) {
    const raw = fs.readFileSync(cfgPath, 'utf8');
    fileConfig = JSON.parse(raw) as Partial<FirebaseAppletConfigFile>;
  }

  const envProjectId =
    process.env.GOOGLE_CLOUD_PROJECT?.trim() || process.env.FIREBASE_PROJECT_ID?.trim();
  const envDatabaseId = process.env.FIRESTORE_DATABASE_ID?.trim();

  const resolvedDbId =
    envDatabaseId || fileConfig.firestoreDatabaseId || DEFAULT_FIRESTORE_DATABASE_ID;
  if (resolvedDbId === '(default)') {
    throw new Error(
      'Refusing to target "(default)" Firestore database; configure ai-studio-85830e53-0349-481d-ae27-ffdfdecbe5c5.',
    );
  }

  cachedConfig = {
    projectId: envProjectId || fileConfig.projectId || DEFAULT_PROJECT_ID,
    firestoreDatabaseId: resolvedDbId,
  };
  return cachedConfig;
}

export function getFirebaseAdminApp(): { app: App; auth: Auth; db: Firestore } {
  const cfg = loadFirebaseAppletConfig();
  if (!cachedAdminApp) {
    if (getApps().length > 0) {
      cachedAdminApp = getApps()[0]!;
    } else {
      const serviceAccount = parseFirebaseServiceAccountFromEnv();
      cachedAdminApp = serviceAccount
        ? initializeApp({
            credential: cert(serviceAccount),
            projectId: cfg.projectId,
          })
        : initializeApp({ projectId: cfg.projectId });
    }
  }
  const auth = getAuth(cachedAdminApp);
  const db = getFirestore(
    cachedAdminApp,
    cfg.firestoreDatabaseId || DEFAULT_FIRESTORE_DATABASE_ID,
  );
  return { app: cachedAdminApp, auth, db };
}

/**
 * Production Firebase ID Token verifier using `firebase-admin/auth`
 * with `checkRevoked: true` so expired, forged, disabled, and revoked tokens
 * are strictly rejected with HTTP 401.
 */
export class FirebaseAdminAuthVerifier implements AuthTokenVerifier {
  private readonly auth: Auth;

  constructor(auth: Auth) {
    this.auth = auth;
  }

  async verifyBearerToken(idToken: string): Promise<VerifiedTokenClaims> {
    try {
      const decoded = await this.auth.verifyIdToken(idToken, true);
      return {
        uid: decoded.uid,
        email: decoded.email,
        emailVerified: decoded.email_verified === true,
        displayName: typeof decoded.name === 'string' ? decoded.name : undefined,
      };
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code)
          : '';
      const message = err instanceof Error ? err.message : String(err);

      if (code === 'auth/id-token-expired') {
        throw new AuthVerificationError('EXPIRED_TOKEN', 'Firebase ID token has expired.', 401);
      }
      if (code === 'auth/id-token-revoked' || code === 'auth/user-disabled') {
        throw new AuthVerificationError(
          'REVOKED_TOKEN',
          'Firebase ID token has been revoked or account is disabled.',
          401,
        );
      }
      if (
        code === 'auth/argument-error' ||
        code === 'auth/invalid-id-token' ||
        code === 'auth/invalid-argument'
      ) {
        throw new AuthVerificationError('INVALID_TOKEN', 'Invalid Firebase ID token.', 401);
      }
      if (/PERMISSION_DENIED|Could not load the default credentials|ENOTFOUND|network/i.test(message)) {
        throw new AuthVerificationError(
          'AUTH_UNAVAILABLE',
          'Firebase Admin SDK credentials or Identity Toolkit service unavailable to verify token revocation.',
          503,
        );
      }
      throw new AuthVerificationError('INVALID_TOKEN', `Token verification failed: ${message}`, 401);
    }
  }
}

function toIsoString(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as Timestamp).toDate === 'function') {
    return (value as Timestamp).toDate().toISOString();
  }
  return fallback;
}

/**
 * Production authoritative Firestore store accessed strictly via Firebase Admin SDK.
 * Never trusts roles, ownership, or consent flags supplied in HTTP request bodies.
 */
export class FirestoreAuthoritativeDataStore implements AuthoritativeDataStore {
  private readonly db: Firestore;

  constructor(db: Firestore) {
    this.db = db;
  }

  private wrapDbError(op: string, err: unknown): never {
    throw new DataStoreUnavailableError(
      `Firestore operation "${op}" failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  async getUserRole(claims: VerifiedTokenClaims): Promise<UserRole> {
    if (isBootstrapAdminEmail(claims.email, claims.emailVerified)) {
      return 'admin';
    }
    try {
      const adminSnap = await this.db.collection('admins').doc(claims.uid).get();
      if (adminSnap.exists && claims.emailVerified) {
        return 'admin';
      }
      const userSnap = await this.db.collection('users').doc(claims.uid).get();
      if (userSnap.exists) {
        const data = userSnap.data() as { role?: string };
        if (data.role === 'admin' && claims.emailVerified) return 'admin';
        if (data.role === 'doctor') return 'doctor';
      }
      return 'patient';
    } catch (err) {
      this.wrapDbError('getUserRole', err);
    }
  }

  private hydratePatient(
    healthId: string,
    data: Record<string, unknown>,
    encounters: ClinicalEncounter[],
  ): StoredPatientRecord {
    const nowIso = new Date().toISOString();
    const patient: MigrantPatient = {
      healthId,
      fullName: String(data.fullName ?? 'Unknown Migrant'),
      age: typeof data.age === 'number' ? data.age : 30,
      gender:
        data.gender === 'Female' || data.gender === 'Male' || data.gender === 'Other'
          ? data.gender
          : 'Other',
      originState: String(data.originState ?? 'Unknown'),
      originDistrict: String(data.originDistrict ?? 'Origin Block'),
      currentState: String(data.currentState ?? 'Unknown'),
      currentDistrict: String(data.currentDistrict ?? 'Destination PHC'),
      primaryLanguage: String(data.primaryLanguage ?? 'Hindi'),
      occupationSector: String(data.occupationSector ?? 'General Labor'),
      phoneLast4: String(data.phoneLast4 ?? '0000'),
      bloodGroup: String(data.bloodGroup ?? 'O+'),
      allergies: Array.isArray(data.allergies) ? data.allergies.map(String) : ['None reported'],
      chronicConditions: Array.isArray(data.chronicConditions)
        ? data.chronicConditions.map(String)
        : [],
      activeMedications: Array.isArray(data.activeMedications)
        ? data.activeMedications.map(String)
        : [],
      medicationGapDays: typeof data.medicationGapDays === 'number' ? data.medicationGapDays : 0,
      daysSinceLastVisit: typeof data.daysSinceLastVisit === 'number' ? data.daysSinceLastVisit : 0,
      recommendedFollowUpDays:
        typeof data.recommendedFollowUpDays === 'number' ? data.recommendedFollowUpDays : 14,
      recordLinkageStatus:
        data.recordLinkageStatus === 'LINKED' ||
        data.recordLinkageStatus === 'PENDING_REVIEW' ||
        data.recordLinkageStatus === 'UNLINKED'
          ? data.recordLinkageStatus
          : 'LINKED',
      externalRefIds: Array.isArray(data.externalRefIds) ? data.externalRefIds.map(String) : [],
      migrationHistory: Array.isArray(data.migrationHistory)
        ? (data.migrationHistory as MigrantPatient['migrationHistory'])
        : [],
      encounters,
      isSimulated: true,
      createdAt: toIsoString(data.createdAt, nowIso),
      updatedAt: toIsoString(data.updatedAt, nowIso),
    };
    return {
      patient,
      ownerUid: String(data.ownerUid ?? ''),
    };
  }

  private async fetchEncounters(healthId: string): Promise<ClinicalEncounter[]> {
    const snap = await this.db
      .collection('patients')
      .doc(healthId)
      .collection('encounters')
      .orderBy('createdAt', 'desc')
      .get();

    return snap.docs.map((d) => {
      const e = d.data() as Record<string, unknown>;
      return {
        encounterId: String(e.encounterId ?? d.id),
        patientHealthId: String(e.patientHealthId ?? healthId),
        facilityName: String(e.facilityName ?? 'PHC Clinic'),
        district: String(e.district ?? 'District'),
        state: String(e.state ?? 'Unknown'),
        encounterDate: String(e.encounterDate ?? toIsoString(e.createdAt, '').slice(0, 10)),
        encounterType:
          e.encounterType === 'DOTS Follow-up' ||
          e.encounterType === 'Antenatal' ||
          e.encounterType === 'Occupational Screening' ||
          e.encounterType === 'Emergency'
            ? e.encounterType
            : 'Outpatient',
        diagnosis: String(e.diagnosis ?? ''),
        icdCode: String(e.icdCode ?? 'Z00.0'),
        medications: Array.isArray(e.medications) ? e.medications.map(String) : [],
        followUpRequired: Boolean(e.followUpRequired),
        followUpDueDate: typeof e.followUpDueDate === 'string' ? e.followUpDueDate : null,
        clinicianName: String(e.clinicianName ?? 'Attending Clinician'),
        notes: String(e.notes ?? ''),
        sourceSystem: String(e.sourceSystem ?? 'MHIS'),
      };
    });
  }

  async getPatientWithOwner(healthId: string): Promise<StoredPatientRecord | null> {
    try {
      const docSnap = await this.db.collection('patients').doc(healthId).get();
      if (!docSnap.exists) return null;
      const encounters = await this.fetchEncounters(healthId);
      return this.hydratePatient(healthId, docSnap.data() as Record<string, unknown>, encounters);
    } catch (err) {
      this.wrapDbError('getPatientWithOwner', err);
    }
  }

  async listPatientsForActor(actor: AuthenticatedPrincipal): Promise<StoredPatientRecord[]> {
    try {
      const col = this.db.collection('patients');
      const snap =
        actor.role === 'admin' || actor.role === 'doctor'
          ? await col.limit(200).get()
          : await col.where('ownerUid', '==', actor.uid).limit(50).get();

      const results: StoredPatientRecord[] = [];
      for (const docSnap of snap.docs) {
        const encounters = await this.fetchEncounters(docSnap.id);
        results.push(this.hydratePatient(docSnap.id, docSnap.data() as Record<string, unknown>, encounters));
      }
      return results;
    } catch (err) {
      this.wrapDbError('listPatientsForActor', err);
    }
  }

  async createOrUpdatePatient(
    patient: MigrantPatient,
    ownerUid: string,
    defaultConsent?: Partial<ConsentPreferences>,
  ): Promise<StoredPatientRecord> {
    try {
      const batch = this.db.batch();
      const patientRef = this.db.collection('patients').doc(patient.healthId);
      const now = Timestamp.now();
      batch.set(patientRef, {
        healthId: patient.healthId,
        fullName: patient.fullName.slice(0, 120),
        age: Math.round(patient.age),
        gender: patient.gender,
        originState: patient.originState.slice(0, 64),
        originDistrict: patient.originDistrict.slice(0, 64),
        currentState: patient.currentState.slice(0, 64),
        currentDistrict: patient.currentDistrict.slice(0, 64),
        primaryLanguage: patient.primaryLanguage.slice(0, 40),
        occupationSector: patient.occupationSector.slice(0, 80),
        phoneLast4: patient.phoneLast4.slice(0, 4),
        bloodGroup: patient.bloodGroup.slice(0, 8),
        allergies: patient.allergies.slice(0, 20),
        chronicConditions: patient.chronicConditions.slice(0, 20),
        activeMedications: patient.activeMedications.slice(0, 20),
        medicationGapDays: patient.medicationGapDays,
        daysSinceLastVisit: patient.daysSinceLastVisit,
        recommendedFollowUpDays: patient.recommendedFollowUpDays,
        recordLinkageStatus: patient.recordLinkageStatus,
        externalRefIds: patient.externalRefIds.slice(0, 20),
        migrationHistory: patient.migrationHistory.slice(0, 30),
        isSimulated: true,
        ownerUid,
        createdAt: now,
        updatedAt: now,
      });

      for (const enc of patient.encounters) {
        const encRef = patientRef.collection('encounters').doc(enc.encounterId);
        batch.set(encRef, {
          ...enc,
          ownerUid,
          createdAt: now,
        });
      }

      const consentRef = this.db.collection('consents').doc(patient.healthId);
      batch.set(consentRef, {
        healthId: patient.healthId,
        ownerUid,
        interStateSharing: defaultConsent?.interStateSharing ?? true,
        emergencyQrAccess: defaultConsent?.emergencyQrAccess ?? true,
        anonymizedSurveillance: defaultConsent?.anonymizedSurveillance ?? true,
        updatedByRole: defaultConsent?.updatedByRole ?? 'patient',
        updatedAt: now,
      });

      await batch.commit();
      return { patient, ownerUid };
    } catch (err) {
      this.wrapDbError('createOrUpdatePatient', err);
    }
  }

  async appendEncounter(
    healthId: string,
    encounter: ClinicalEncounter,
    actorUid: string,
  ): Promise<StoredPatientRecord | null> {
    try {
      const patientRef = this.db.collection('patients').doc(healthId);
      const snap = await patientRef.get();
      if (!snap.exists) return null;

      const batch = this.db.batch();
      const now = Timestamp.now();
      batch.set(patientRef.collection('encounters').doc(encounter.encounterId), {
        ...encounter,
        ownerUid: actorUid,
        createdAt: now,
      });
      batch.update(patientRef, {
        currentState: encounter.state.slice(0, 64),
        currentDistrict: encounter.district.slice(0, 64),
        daysSinceLastVisit: 0,
        medicationGapDays: 0,
        updatedAt: now,
      });
      await batch.commit();
      return this.getPatientWithOwner(healthId);
    } catch (err) {
      this.wrapDbError('appendEncounter', err);
    }
  }

  async recordMigrationMove(
    healthId: string,
    move: { state: string; district: string; sector: string; arrivalDate: string },
  ): Promise<StoredPatientRecord | null> {
    try {
      const patientRef = this.db.collection('patients').doc(healthId);
      await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(patientRef);
        if (!snap.exists) return;
        const data = snap.data() as { migrationHistory?: MigrantPatient['migrationHistory'] };
        const history = Array.isArray(data.migrationHistory) ? [...data.migrationHistory] : [];
        history.push(move);
        tx.update(patientRef, {
          currentState: move.state.slice(0, 64),
          currentDistrict: move.district.slice(0, 64),
          occupationSector: move.sector.slice(0, 80),
          migrationHistory: history.slice(-30),
          updatedAt: Timestamp.now(),
        });
      });
      return this.getPatientWithOwner(healthId);
    } catch (err) {
      this.wrapDbError('recordMigrationMove', err);
    }
  }

  async getConsent(healthId: string): Promise<ConsentPreferences | null> {
    try {
      const snap = await this.db.collection('consents').doc(healthId).get();
      if (!snap.exists) return null;
      const d = snap.data() as Record<string, unknown>;
      return {
        healthId,
        interStateSharing: Boolean(d.interStateSharing),
        emergencyQrAccess: Boolean(d.emergencyQrAccess),
        anonymizedSurveillance: Boolean(d.anonymizedSurveillance),
        updatedAt: toIsoString(d.updatedAt, new Date().toISOString()),
        updatedByRole:
          d.updatedByRole === 'admin' || d.updatedByRole === 'doctor' ? d.updatedByRole : 'patient',
      };
    } catch (err) {
      this.wrapDbError('getConsent', err);
    }
  }

  async updateConsent(
    healthId: string,
    ownerUid: string,
    patch: Partial<
      Pick<ConsentPreferences, 'interStateSharing' | 'emergencyQrAccess' | 'anonymizedSurveillance'>
    >,
    actorRole: UserRole,
  ): Promise<ConsentPreferences> {
    try {
      const ref = this.db.collection('consents').doc(healthId);
      return await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const existing = snap.exists ? (snap.data() as Record<string, unknown>) : {};
        const next: ConsentPreferences = {
          healthId,
          interStateSharing: patch.interStateSharing ?? Boolean(existing.interStateSharing ?? false),
          emergencyQrAccess: patch.emergencyQrAccess ?? Boolean(existing.emergencyQrAccess ?? false),
          anonymizedSurveillance:
            patch.anonymizedSurveillance ?? Boolean(existing.anonymizedSurveillance ?? false),
          updatedAt: new Date().toISOString(),
          updatedByRole: actorRole,
        };
        tx.set(ref, {
          healthId,
          ownerUid: String(existing.ownerUid || ownerUid),
          interStateSharing: next.interStateSharing,
          emergencyQrAccess: next.emergencyQrAccess,
          anonymizedSurveillance: next.anonymizedSurveillance,
          updatedByRole: actorRole,
          updatedAt: Timestamp.now(),
        });
        return next;
      });
    } catch (err) {
      this.wrapDbError('updateConsent', err);
    }
  }

  async appendAuditLog(entry: AccessAuditEntry, ownerUid: string): Promise<void> {
    try {
      await this.db.collection('auditLogs').doc(entry.logId).set({
        ...entry,
        ownerUid,
        createdAt: Timestamp.now(),
      });
    } catch (err) {
      this.wrapDbError('appendAuditLog', err);
    }
  }

  async listAuditLogsForActor(actor: AuthenticatedPrincipal): Promise<AccessAuditEntry[]> {
    try {
      const col = this.db.collection('auditLogs');
      const snap =
        actor.role === 'admin' || actor.role === 'doctor'
          ? await col.orderBy('createdAt', 'desc').limit(100).get()
          : await col.where('ownerUid', '==', actor.uid).orderBy('createdAt', 'desc').limit(100).get();

      return snap.docs.map((d) => {
        const l = d.data() as Record<string, unknown>;
        return {
          logId: String(l.logId ?? d.id),
          healthId: String(l.healthId ?? ''),
          patientName: String(l.patientName ?? 'Protected Record'),
          actorRole:
            l.actorRole === 'admin' || l.actorRole === 'doctor' ? l.actorRole : 'patient',
          actorName: String(l.actorName ?? 'System'),
          facilityState: String(l.facilityState ?? 'National Portal'),
          action: String(l.action ?? ''),
          scope: String(l.scope ?? ''),
          purpose: String(l.purpose ?? ''),
          timestamp: toIsoString(l.createdAt, new Date().toISOString()),
        };
      });
    } catch (err) {
      this.wrapDbError('listAuditLogsForActor', err);
    }
  }

  async listLinkageCandidates(): Promise<LinkageCandidate[]> {
    try {
      const snap = await this.db.collection('linkageCandidates').limit(100).get();
      return snap.docs.map((d) => d.data() as LinkageCandidate);
    } catch (err) {
      this.wrapDbError('listLinkageCandidates', err);
    }
  }

  async resolveLinkageCandidate(
    candidateId: string,
    decision: 'MERGED' | 'REJECTED',
  ): Promise<LinkageCandidate | null> {
    try {
      const ref = this.db.collection('linkageCandidates').doc(candidateId);
      const snap = await ref.get();
      if (!snap.exists) return null;
      const cand = snap.data() as LinkageCandidate;
      const updated: LinkageCandidate = { ...cand, status: decision };
      await ref.update({ status: decision });

      if (decision === 'MERGED') {
        const patRef = this.db.collection('patients').doc(cand.matchedHealthId);
        const patSnap = await patRef.get();
        if (patSnap.exists) {
          const pData = patSnap.data() as { externalRefIds?: string[] };
          const refs = Array.isArray(pData.externalRefIds) ? [...pData.externalRefIds] : [];
          if (!refs.includes(cand.incomingRecordRef)) refs.push(cand.incomingRecordRef);
          await patRef.update({
            externalRefIds: refs,
            recordLinkageStatus: 'LINKED',
            updatedAt: Timestamp.now(),
          });
        }
      }
      return updated;
    } catch (err) {
      this.wrapDbError('resolveLinkageCandidate', err);
    }
  }
}
