import type { ConsentPreferences, MigrantPatient, UserRole } from '../types/health.ts';

export interface ConsentFilteredPatientView {
  patient: MigrantPatient;
  consentRestricted: boolean;
  withheldEncounterCount: number;
  restrictionReason: string | null;
}

/**
 * Enforces patient inter-state sharing consent for clinical & AI views.
 * If interStateSharing is false and a clinician/admin inspects a migrant
 * currently located in a different state from their origin state, encounters
 * recorded in external/origin states are redacted before rendering or RAG indexing.
 */
export function applyInterStateConsent(
  patient: MigrantPatient,
  consent: ConsentPreferences | undefined,
  actorRole: UserRole,
): ConsentFilteredPatientView {
  if (actorRole === 'patient') {
    return {
      patient,
      consentRestricted: false,
      withheldEncounterCount: 0,
      restrictionReason: null,
    };
  }

  const sharingAllowed = consent?.interStateSharing ?? true;
  if (sharingAllowed) {
    return {
      patient,
      consentRestricted: false,
      withheldEncounterCount: 0,
      restrictionReason: null,
    };
  }

  const externalEncounters = patient.encounters.filter(
    (enc) => enc.state.toLowerCase() !== patient.currentState.toLowerCase(),
  );
  const localEncountersRaw = patient.encounters.filter(
    (enc) => enc.state.toLowerCase() === patient.currentState.toLowerCase(),
  );
  const withheldCount = patient.encounters.length - localEncountersRaw.length;

  const restrictedTerms = Array.from(
    new Set(
      [
        patient.originState,
        patient.originDistrict,
        ...externalEncounters.map((e) => e.state),
        ...externalEncounters.map((e) => e.district),
      ]
        .map((t) => t.trim())
        .filter(
          (t) =>
            t.length >= 3 &&
            t.toLowerCase() !== patient.currentState.toLowerCase() &&
            t.toLowerCase() !== patient.currentDistrict.toLowerCase() &&
            !t.toLowerCase().startsWith('withheld'),
        ),
    ),
  ).sort((a, b) => b.length - a.length);

  const redactExternalMentions = (value: string): string => {
    let sanitized = value;
    for (const term of restrictedTerms) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      sanitized = sanitized.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '[Withheld Origin]');
    }
    return sanitized;
  };

  const localEncounters = localEncountersRaw.map((enc) => ({
    ...enc,
    diagnosis: redactExternalMentions(enc.diagnosis),
    notes: redactExternalMentions(enc.notes),
    facilityName: redactExternalMentions(enc.facilityName),
  }));

  const localConditions =
    withheldCount > 0
      ? [
          ...localEncounters.map((enc) => enc.diagnosis),
          'External-state chronic conditions withheld pending inter-state consent',
        ]
      : patient.chronicConditions.map(redactExternalMentions);

  const localMedications =
    withheldCount > 0
      ? Array.from(new Set(localEncounters.flatMap((enc) => enc.medications)))
      : patient.activeMedications;

  const localMigrationHistory = patient.migrationHistory.filter(
    (m) => m.state.toLowerCase() === patient.currentState.toLowerCase(),
  );

  const redactedPatient: MigrantPatient = {
    ...patient,
    originState: 'Withheld (Inter-State Consent Required)',
    originDistrict: 'Withheld',
    externalRefIds: [],
    chronicConditions:
      localEncounters.length > 0 ? localConditions : ['Withheld pending patient inter-state consent'],
    activeMedications: localEncounters.length > 0 ? localMedications : [],
    migrationHistory: localMigrationHistory,
    encounters: localEncounters,
  };

  return {
    patient: redactedPatient,
    consentRestricted: true,
    withheldEncounterCount: withheldCount,
    restrictionReason:
      'Patient has revoked Inter-State Primary Clinic Record Sharing. Origin location, cross-state encounters, and origin prescriptions are withheld.',
  };
}

export function filterSurveillancePatients(
  patients: MigrantPatient[],
  consents: Record<string, ConsentPreferences>,
): MigrantPatient[] {
  return patients.filter((p) => consents[p.healthId]?.anonymizedSurveillance === true);
}

