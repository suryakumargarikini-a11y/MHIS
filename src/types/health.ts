export type UserRole = 'admin' | 'doctor' | 'patient';

export type AppRoute =
  | 'overview'
  | 'admin'
  | 'doctor'
  | 'patient'
  | 'register'
  | 'consent'
  | 'audit'
  | 'privacy'
  | 'terms';

export type RiskTier = 'LOW' | 'MODERATE' | 'HIGH';

export type LinkageStatus = 'LINKED' | 'PENDING_REVIEW' | 'UNLINKED';

export interface ClinicalEncounter {
  encounterId: string;
  patientHealthId: string;
  facilityName: string;
  district: string;
  state: string;
  encounterDate: string; // ISO YYYY-MM-DD
  encounterType: 'Outpatient' | 'DOTS Follow-up' | 'Antenatal' | 'Occupational Screening' | 'Emergency';
  diagnosis: string;
  icdCode: string;
  medications: string[];
  followUpRequired: boolean;
  followUpDueDate: string | null;
  clinicianName: string;
  notes: string;
  sourceSystem: string;
}

export interface MigrationHop {
  state: string;
  district: string;
  arrivalDate: string;
  sector: string;
}

export interface MigrantPatient {
  healthId: string;
  fullName: string;
  age: number;
  gender: 'Female' | 'Male' | 'Other';
  originState: string;
  originDistrict: string;
  currentState: string;
  currentDistrict: string;
  primaryLanguage: string;
  occupationSector: string;
  phoneLast4: string;
  bloodGroup: string;
  allergies: string[];
  chronicConditions: string[];
  activeMedications: string[];
  medicationGapDays: number;
  daysSinceLastVisit: number;
  recommendedFollowUpDays: number;
  recordLinkageStatus: LinkageStatus;
  externalRefIds: string[];
  migrationHistory: MigrationHop[];
  encounters: ClinicalEncounter[];
  isSimulated: true;
  createdAt: string;
  updatedAt: string;
}

export interface RiskFactorBreakdown {
  factor: string;
  points: number;
  maxPoints: number;
  rationale: string;
}

export interface ContinuityRiskResult {
  score: number;
  tier: RiskTier;
  factors: RiskFactorBreakdown[];
  recommendedAction: string;
  methodologyNote?: string;
}

export interface LinkageMatchSignal {
  signal: string;
  weight: number;
  matchedValue: string;
}

export interface LinkageCandidate {
  candidateId: string;
  incomingRecordRef: string;
  incomingFacility: string;
  incomingState: string;
  incomingName: string;
  incomingAge: number;
  incomingOriginState: string;
  incomingPhoneLast4: string;
  matchedHealthId: string;
  matchedPatientName: string;
  similarityScore: number;
  recommendation: 'AUTO_LINK' | 'CLINICIAN_REVIEW' | 'DISTINCT_PATIENT';
  signals: LinkageMatchSignal[];
  status: 'PENDING' | 'MERGED' | 'REJECTED';
  createdAt: string;
}

export interface ConsentPreferences {
  healthId: string;
  interStateSharing: boolean;
  emergencyQrAccess: boolean;
  anonymizedSurveillance: boolean;
  updatedAt: string;
  updatedByRole: UserRole;
}

export interface AccessAuditEntry {
  logId: string;
  healthId: string;
  patientName: string;
  actorRole: UserRole;
  actorName: string;
  facilityState: string;
  action: string;
  scope: string;
  purpose: string;
  timestamp: string;
}

export interface QrHealthPassPayload {
  schema: 'MHIS-QR-v2';
  passId: string;
  healthId: string;
  displayName: string;
  bloodGroup: string;
  primaryLanguage: string;
  allergies: string[];
  activeConditions: string[];
  emergencyConsent: boolean;
  issuedAt: string;
  expiresAt: string;
  kid: string;
  keyVersion: number;
  signature: string;
}

export interface RagSourceChunk {
  chunkId: string;
  encounterId: string;
  title: string;
  state: string;
  date: string;
  excerpt: string;
  relevanceScore: number;
}
