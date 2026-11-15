import type {
  AccessAuditEntry,
  ClinicalEncounter,
  ConsentPreferences,
  LinkageCandidate,
  MigrantPatient,
  UserRole,
} from '../types/health.ts';
import {
  INITIAL_AUDIT_LOGS,
  INITIAL_CONSENTS,
  INITIAL_LINKAGE_CANDIDATES,
  INITIAL_PATIENTS,
} from '../data/syntheticPatients.ts';
import {
  AuthVerificationError,
  DataStoreUnavailableError,
  type AuthenticatedPrincipal,
  type AuthoritativeDataStore,
  type AuthTokenVerifier,
  type StoredPatientRecord,
  type VerifiedTokenClaims,
} from './firebaseAdminAuth.ts';
import { isBootstrapAdminEmail } from './rbac.ts';

export interface TestTokenRecord {
  status: 'valid' | 'expired' | 'revoked';
  claims: VerifiedTokenClaims;
}

/**
 * Deterministic token verifier ONLY for automated integration tests.
 * Allows testing missing, invalid, expired, and revoked Firebase ID tokens.
 */
export class TestTokenVerifier implements AuthTokenVerifier {
  public tokens = new Map<string, TestTokenRecord>();

  registerToken(token: string, record: TestTokenRecord): void {
    this.tokens.set(token, record);
  }

  revokeToken(token: string): void {
    const existing = this.tokens.get(token);
    if (existing) {
      this.tokens.set(token, { ...existing, status: 'revoked' });
    }
  }

  async verifyBearerToken(idToken: string): Promise<VerifiedTokenClaims> {
    const entry = this.tokens.get(idToken);
    if (!entry) {
      throw new AuthVerificationError('INVALID_TOKEN', 'Invalid Firebase ID token.', 401);
    }
    if (entry.status === 'expired') {
      throw new AuthVerificationError('EXPIRED_TOKEN', 'Firebase ID token has expired.', 401);
    }
    if (entry.status === 'revoked') {
      throw new AuthVerificationError(
        'REVOKED_TOKEN',
        'Firebase ID token has been revoked.',
        401,
      );
    }
    return entry.claims;
  }
}

/**
 * Shared authoritative test store simulating Firestore persistence across multiple
 * Express server instances for integration, RBAC, consent-revocation, and outage tests.
 */
export class TestAuthoritativeDataStore implements AuthoritativeDataStore {
  public rolesByUid = new Map<string, UserRole>();
  public patients = new Map<string, StoredPatientRecord>();
  public consents = new Map<string, ConsentPreferences>();
  public auditLogs: Array<{ entry: AccessAuditEntry; ownerUid: string }> = [];
  public linkageCandidates = new Map<string, LinkageCandidate>();
  public simulateOutage = false;

  constructor(options?: { seedSynthetic?: boolean }) {
    if (options?.seedSynthetic !== false) {
      INITIAL_PATIENTS.forEach((p, idx) => {
        const ownerUid = `uid-patient-${idx + 1}`;
        this.patients.set(p.healthId, {
          patient: structuredClone(p),
          ownerUid,
        });
        this.rolesByUid.set(ownerUid, 'patient');
      });
      for (const [healthId, c] of Object.entries(INITIAL_CONSENTS)) {
        this.consents.set(healthId, structuredClone(c));
      }
      for (const l of INITIAL_AUDIT_LOGS) {
        this.auditLogs.push({ entry: structuredClone(l), ownerUid: 'uid-patient-1' });
      }
      for (const cand of INITIAL_LINKAGE_CANDIDATES) {
        this.linkageCandidates.set(cand.candidateId, structuredClone(cand));
      }
    }
  }

  private guardOutage() {
    if (this.simulateOutage) {
      throw new DataStoreUnavailableError('Simulated authoritative data store outage.');
    }
  }

  async getUserRole(claims: VerifiedTokenClaims): Promise<UserRole> {
    this.guardOutage();
    if (isBootstrapAdminEmail(claims.email, claims.emailVerified)) {
      return 'admin';
    }
    return this.rolesByUid.get(claims.uid) ?? 'patient';
  }

  async getPatientWithOwner(healthId: string): Promise<StoredPatientRecord | null> {
    this.guardOutage();
    const rec = this.patients.get(healthId);
    return rec ? structuredClone(rec) : null;
  }

  async listPatientsForActor(actor: AuthenticatedPrincipal): Promise<StoredPatientRecord[]> {
    this.guardOutage();
    const all = Array.from(this.patients.values());
    if (actor.role === 'admin' || actor.role === 'doctor') {
      return all.map((r) => structuredClone(r));
    }
    return all.filter((r) => r.ownerUid === actor.uid).map((r) => structuredClone(r));
  }

  async createOrUpdatePatient(
    patient: MigrantPatient,
    ownerUid: string,
    defaultConsent?: Partial<ConsentPreferences>,
  ): Promise<StoredPatientRecord> {
    this.guardOutage();
    const record: StoredPatientRecord = { patient: structuredClone(patient), ownerUid };
    this.patients.set(patient.healthId, record);
    if (!this.consents.has(patient.healthId)) {
      this.consents.set(patient.healthId, {
        healthId: patient.healthId,
        interStateSharing: defaultConsent?.interStateSharing ?? true,
        emergencyQrAccess: defaultConsent?.emergencyQrAccess ?? true,
        anonymizedSurveillance: defaultConsent?.anonymizedSurveillance ?? true,
        updatedAt: new Date().toISOString(),
        updatedByRole: defaultConsent?.updatedByRole ?? 'patient',
      });
    }
    return structuredClone(record);
  }

  async appendEncounter(
    healthId: string,
    encounter: ClinicalEncounter,
  ): Promise<StoredPatientRecord | null> {
    this.guardOutage();
    const rec = this.patients.get(healthId);
    if (!rec) return null;
    rec.patient.encounters = [structuredClone(encounter), ...rec.patient.encounters];
    rec.patient.currentState = encounter.state;
    rec.patient.currentDistrict = encounter.district;
    rec.patient.daysSinceLastVisit = 0;
    rec.patient.medicationGapDays = 0;
    rec.patient.updatedAt = new Date().toISOString();
    return structuredClone(rec);
  }

  async recordMigrationMove(
    healthId: string,
    move: { state: string; district: string; sector: string; arrivalDate: string },
  ): Promise<StoredPatientRecord | null> {
    this.guardOutage();
    const rec = this.patients.get(healthId);
    if (!rec) return null;
    rec.patient.currentState = move.state;
    rec.patient.currentDistrict = move.district;
    rec.patient.occupationSector = move.sector || rec.patient.occupationSector;
    rec.patient.migrationHistory.push(move);
    rec.patient.updatedAt = new Date().toISOString();
    return structuredClone(rec);
  }

  async getConsent(healthId: string): Promise<ConsentPreferences | null> {
    this.guardOutage();
    const c = this.consents.get(healthId);
    return c ? structuredClone(c) : null;
  }

  async updateConsent(
    healthId: string,
    _ownerUid: string,
    patch: Partial<
      Pick<ConsentPreferences, 'interStateSharing' | 'emergencyQrAccess' | 'anonymizedSurveillance'>
    >,
    actorRole: UserRole,
  ): Promise<ConsentPreferences> {
    this.guardOutage();
    const existing = this.consents.get(healthId) ?? {
      healthId,
      interStateSharing: false,
      emergencyQrAccess: false,
      anonymizedSurveillance: false,
      updatedAt: new Date().toISOString(),
      updatedByRole: actorRole,
    };
    const next: ConsentPreferences = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
      updatedByRole: actorRole,
    };
    this.consents.set(healthId, next);
    return structuredClone(next);
  }

  async appendAuditLog(entry: AccessAuditEntry, ownerUid: string): Promise<void> {
    this.guardOutage();
    this.auditLogs.unshift({ entry: structuredClone(entry), ownerUid });
  }

  async listAuditLogsForActor(actor: AuthenticatedPrincipal): Promise<AccessAuditEntry[]> {
    this.guardOutage();
    if (actor.role === 'admin' || actor.role === 'doctor') {
      return this.auditLogs.map((l) => structuredClone(l.entry));
    }
    return this.auditLogs
      .filter((l) => l.ownerUid === actor.uid)
      .map((l) => structuredClone(l.entry));
  }

  async listLinkageCandidates(): Promise<LinkageCandidate[]> {
    this.guardOutage();
    return Array.from(this.linkageCandidates.values()).map((c) => structuredClone(c));
  }

  async resolveLinkageCandidate(
    candidateId: string,
    decision: 'MERGED' | 'REJECTED',
  ): Promise<LinkageCandidate | null> {
    this.guardOutage();
    const cand = this.linkageCandidates.get(candidateId);
    if (!cand) return null;
    cand.status = decision;
    if (decision === 'MERGED') {
      const target = this.patients.get(cand.matchedHealthId);
      if (target && !target.patient.externalRefIds.includes(cand.incomingRecordRef)) {
        target.patient.externalRefIds.push(cand.incomingRecordRef);
        target.patient.recordLinkageStatus = 'LINKED';
      }
    }
    return structuredClone(cand);
  }
}
